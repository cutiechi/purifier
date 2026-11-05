package api

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"purifier/internal/api/auth"
	"purifier/internal/pkg/httputil"
	"purifier/internal/provider/cool18"
	"purifier/internal/provider/xchina"
	"purifier/internal/storage"
)

type RouterDependencies struct {
	Store         *storage.Store
	Cool18Handler *cool18.Handler
	Cool18Service *cool18.Service
	XChinaHandler *xchina.Handler
	XChinaService *xchina.Service
	MeHandler     http.Handler
	AuthHandler   *auth.Handler
	WebDist       string
}

func SetupRouter(deps RouterDependencies) *chi.Mux {
	r := chi.NewRouter()

	// 基础中间件
	r.Use(middleware.RequestID)
	// RealIP 会无条件信任 X-Forwarded-For / X-Real-IP。只有在反向代理后面
	// 才应启用（TRUST_PROXY=1），否则任何能直连端口的客户端都能伪造来源 IP，
	// 绕过按 IP 的限流。
	if trustProxy() {
		r.Use(middleware.RealIP)
	}
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	// CORS：本应用同源部署（SPA 由本服务托管），不放行任意源携带凭据。
	// 需要跨源调试时用 ALLOWED_ORIGINS 显式列出。
	if origins := parseAllowedOrigins(os.Getenv("ALLOWED_ORIGINS")); len(origins) > 0 {
		r.Use(cors.Handler(cors.Options{
			AllowedOrigins:   origins,
			AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
			AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
			ExposedHeaders:   []string{"Link"},
			AllowCredentials: true,
			MaxAge:           300,
		}))
	}

	// 1. API 路由
	r.Route("/api", func(r chi.Router) {
		// 请求体上限：所有写接口共用，挡住把整库塞进内存的解码。
		r.Use(limitBodyMiddleware)

		// 健康检查
		r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
			httputil.JSON(w, http.StatusOK, map[string]string{
				"status":  "ok",
				"runtime": "go",
			}, nil)
		})

		// 认证路由
		if deps.AuthHandler != nil {
			r.Mount("/auth", deps.AuthHandler.Routes())
		}

		// 2026 规范：全新垂直切片独立路由 v1
		r.Route("/v1", func(r chi.Router) {
			r.Mount("/cool18", deps.Cool18Handler.Routes())
			r.Mount("/xchina", deps.XChinaHandler.Routes())

			r.Group(func(r chi.Router) {
				if deps.AuthHandler != nil {
					r.Use(deps.AuthHandler.Middleware)
				}
				r.Mount("/me", deps.MeHandler)
			})
		})

		// 兼容层：对齐旧版前端调用 (/api/posts, /api/books, /api/me/*)
		r.Group(func(r chi.Router) {
			if deps.AuthHandler != nil {
				r.Use(deps.AuthHandler.Middleware)
			}
			r.Mount("/me", deps.MeHandler)
		})

		// 列表类接口统一套一层短 TTL 进程缓存（refresh=1 绕过）
		listCached := func(h http.HandlerFunc) http.HandlerFunc {
			cached := listCacheMiddleware(h)
			return func(w http.ResponseWriter, r *http.Request) { cached.ServeHTTP(w, r) }
		}

		r.Get("/posts", listCached(func(w http.ResponseWriter, r *http.Request) {
			site, err := resolveSiteParam(r.URL.Query().Get("site"))
			if err != nil {
				httputil.JSONError(w, http.StatusBadRequest, "invalid site")
				return
			}
			tid := r.URL.Query().Get("tid")
			mtid := r.URL.Query().Get("mtid")

			// site=2：书库站无帖子模型，但首页更新流走同一入口
			// （legacy 语义：带 tid 才拒；不带 tid 返回该书库的更新列表）
			if site == xchina.XChinaSiteID {
				if tid != "" {
					httputil.JSONError(w, http.StatusNotFound, "site 2 does not support posts")
					return
				}
				res, err := deps.XChinaService.HomeFeed(r.Context(), mtid)
				if err != nil {
					httputil.Error(w, err)
					return
				}
				httputil.JSON(w, http.StatusOK, res, httputil.ListCacheHeaders)
				return
			}

			if tid != "" && r.URL.Query().Get("meta") == "1" {
				// 只取标题：补充分组等场景不需要正文/跟帖，也不应写阅读历史
				res, err := deps.Cool18Service.GetPostMeta(r.Context(), tid)
				if err != nil {
					httputil.Error(w, err)
					return
				}
				httputil.JSON(w, http.StatusOK, res, httputil.ContentHeaders(false, false))
				return
			}

			if tid != "" {
				// 获取单帖
				refresh := r.URL.Query().Get("refresh") == "1"
				res, err := deps.Cool18Service.GetPost(r.Context(), tid, refresh)
				if err != nil {
					httputil.Error(w, err)
					return
				}
				httputil.JSON(w, http.StatusOK, res, httputil.ContentHeaders(refresh, res.Stale))
				return
			}

			// 获取首页列表
			res, err := deps.Cool18Service.GetHomePosts(r.Context(), mtid)
			if err != nil {
				httputil.Error(w, err)
				return
			}
			httputil.JSON(w, http.StatusOK, res, httputil.ListCacheHeaders)
		}))

		r.Get("/books/home", deps.XChinaHandler.HandleGetHome)
		r.Get("/books", func(w http.ResponseWriter, r *http.Request) {
			cid := r.URL.Query().Get("cid")
			if cid == "" {
				httputil.JSONError(w, http.StatusBadRequest, "missing cid parameter")
				return
			}
			chapterStr := r.URL.Query().Get("chapter")
			refresh := r.URL.Query().Get("refresh") == "1"
			site, siteErr := resolveSiteParam(r.URL.Query().Get("site"))
			if siteErr != nil {
				httputil.JSONError(w, http.StatusBadRequest, "invalid site")
				return
			}

			// site=1：Cool18 书库藏文（bookview 整本一页，无章节模型）
			if site != xchina.XChinaSiteID {
				if chapterStr != "" {
					httputil.JSONError(w, http.StatusNotFound, "site 1 book has no chapters")
					return
				}
				res, err := deps.Cool18Service.GetBook(r.Context(), cid, refresh)
				if err != nil {
					httputil.Error(w, err)
					return
				}
				httputil.JSON(w, http.StatusOK, res, httputil.ContentHeaders(refresh, res.Stale))
				return
			}

			if chapterStr != "" {
				ch, err := strconvAtoi(chapterStr)
				if err != nil {
					httputil.JSONError(w, http.StatusBadRequest, "invalid chapter")
					return
				}
				res, err := deps.XChinaService.GetChapter(r.Context(), cid, ch, refresh)
				if err != nil {
					httputil.Error(w, err)
					return
				}
				httputil.JSON(w, http.StatusOK, res, httputil.ContentHeaders(refresh, res.Stale))
				return
			}

			res, err := deps.XChinaService.GetBook(r.Context(), cid, refresh)
			if err != nil {
				httputil.Error(w, err)
				return
			}
			httputil.JSON(w, http.StatusOK, res, httputil.ContentHeaders(refresh, res.Stale))
		})

		r.Get("/categories", func(w http.ResponseWriter, r *http.Request) {
			site, siteErr := resolveSiteParam(r.URL.Query().Get("site"))
			if siteErr != nil {
				httputil.JSONError(w, http.StatusBadRequest, "invalid site")
				return
			}
			if site == xchina.XChinaSiteID {
				links, err := deps.XChinaService.GetCategories(r.Context())
				if err != nil {
					httputil.Error(w, err)
					return
				}
				httputil.JSON(w, http.StatusOK, map[string]any{"links": links}, httputil.ListCacheHeaders)
				return
			}
			deps.Cool18Handler.HandleCategories(w, r)
		})
		// 书库站无这些板块（与 legacy extractor 的 notSupported 404 对齐）
		unsupportedOnLibrary := func(name string, handler http.HandlerFunc) http.HandlerFunc {
			return func(w http.ResponseWriter, r *http.Request) {
				site, siteErr := resolveSiteParam(r.URL.Query().Get("site"))
				if siteErr != nil {
					httputil.JSONError(w, http.StatusBadRequest, "invalid site")
					return
				}
				if site == xchina.XChinaSiteID {
					httputil.JSONError(w, http.StatusNotFound,
						fmt.Sprintf("site 2 does not support %s", name))
					return
				}
				handler(w, r)
			}
		}
		r.Get("/featured", listCached(unsupportedOnLibrary("featured", deps.Cool18Handler.HandleFeatured)))
		r.Get("/picks", listCached(unsupportedOnLibrary("picks", deps.Cool18Handler.HandlePicks)))
		r.Get("/comments", listCached(unsupportedOnLibrary("comments", deps.Cool18Handler.HandleComments)))
		r.Get("/trending", listCached(func(w http.ResponseWriter, r *http.Request) {
			site, siteErr := resolveSiteParam(r.URL.Query().Get("site"))
			if siteErr != nil {
				httputil.JSONError(w, http.StatusBadRequest, "invalid site")
				return
			}
			if site == xchina.XChinaSiteID {
				posts, err := deps.XChinaService.GetTrending(r.Context())
				if err != nil {
					httputil.Error(w, err)
					return
				}
				httputil.JSON(w, http.StatusOK, map[string]any{"posts": posts}, httputil.ListCacheHeaders)
				return
			}
			deps.Cool18Handler.HandleTrending(w, r)
		}))
		r.Get("/browse", listCached(func(w http.ResponseWriter, r *http.Request) {
			site, siteErr := resolveSiteParam(r.URL.Query().Get("site"))
			if siteErr != nil {
				httputil.JSONError(w, http.StatusBadRequest, "invalid site")
				return
			}
			if site == xchina.XChinaSiteID {
				categoryType := r.URL.Query().Get("type")
				keywords := r.URL.Query().Get("q")
				page := 1
				if p, err := strconvAtoi(r.URL.Query().Get("page")); err == nil && p > 1 {
					page = p
				}
				res, err := deps.XChinaService.Browse(r.Context(), categoryType, keywords, page)
				if err != nil {
					httputil.Error(w, err)
					return
				}
				httputil.JSON(w, http.StatusOK, res, httputil.ListCacheHeaders)
				return
			}
			deps.Cool18Handler.HandleBrowse(w, r)
		}))
	})

	// 2. 前端 SPA 静态托管及回退
	if deps.WebDist != "" {
		if _, err := os.Stat(deps.WebDist); err == nil {
			fileServer(r, "/", http.Dir(deps.WebDist))
		}
	}

	return r
}

// trustProxy 报告是否信任反向代理写入的转发头。
// 生产部署在 Nginx Proxy Manager 后面时设 TRUST_PROXY=1。
func trustProxy() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("TRUST_PROXY"))) {
	case "1", "true", "yes":
		return true
	default:
		return false
	}
}

func strconvAtoi(s string) (int, error) {
	n, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil || n < 0 {
		return 0, errors.New("invalid number")
	}
	return n, nil
}

// resolveSiteParam 校验 site 查询参数：空视为默认站，未知站返回错误。
// legacy resolveSite 对未知站点同样报 400，避免拼错时静默回落到论坛数据。
func resolveSiteParam(raw string) (string, error) {
	switch raw {
	case "":
		return cool18.Cool18SiteID, nil
	case cool18.Cool18SiteID, xchina.XChinaSiteID:
		return raw, nil
	default:
		return "", fmt.Errorf("unknown site: %s", raw)
	}
}

// fileServer 静态资源托管，未匹配文件自动 fallback 回 index.html
func fileServer(r chi.Router, path string, root http.FileSystem) {
	if strings.ContainsAny(path, "{}*") {
		panic("FileServer does not permit any URL parameters.")
	}

	fs := http.StripPrefix(path, http.FileServer(root))

	r.Get(path+"*", func(w http.ResponseWriter, req *http.Request) {
		// 如果是 /api 开头且未匹配，报 404 JSON
		if strings.HasPrefix(req.URL.Path, "/api") {
			httputil.JSONError(w, http.StatusNotFound, "api route not found")
			return
		}

		f, err := root.Open(filepath.Clean(req.URL.Path))
		if err != nil {
			// 文件不存在时 SPA fallback
			indexFile, iErr := root.Open("index.html")
			if iErr == nil {
				defer indexFile.Close()
				http.ServeContent(w, req, "index.html", time.Time{}, indexFile)
				return
			}
		} else {
			_ = f.Close()
		}

		fs.ServeHTTP(w, req)
	})
}

// parseAllowedOrigins 解析逗号分隔的允许来源列表。
func parseAllowedOrigins(raw string) []string {
	var out []string
	for _, part := range strings.Split(raw, ",") {
		if o := strings.TrimSpace(part); o != "" {
			out = append(out, o)
		}
	}
	return out
}
