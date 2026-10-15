package api

import (
	"net/http"
	"os"
	"path/filepath"
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
	Store          *storage.Store
	Cool18Handler  *cool18.Handler
	Cool18Service  *cool18.Service
	XChinaHandler  *xchina.Handler
	XChinaService  *xchina.Service
	MeHandler      http.Handler
	AuthHandler    *auth.Handler
	WebDist        string
}

func SetupRouter(deps RouterDependencies) *chi.Mux {
	r := chi.NewRouter()

	// 基础中间件
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	// CORS 跨域配置
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// 1. API 路由
	r.Route("/api", func(r chi.Router) {
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

		r.Get("/posts", func(w http.ResponseWriter, r *http.Request) {
			tid := r.URL.Query().Get("tid")
			if tid != "" {
				// 获取单帖
				refresh := r.URL.Query().Get("refresh") == "1"
				res, err := deps.Cool18Service.GetPost(r.Context(), tid, refresh)
				if err != nil {
					httputil.JSONError(w, http.StatusInternalServerError, err.Error())
					return
				}
				headers := httputil.ContentCacheHeaders
				if refresh || res.Stale {
					headers = httputil.NoStoreHeaders
				}
				httputil.JSON(w, http.StatusOK, res, headers)
				return
			}

			// 获取首页列表
			mtid := r.URL.Query().Get("mtid")
			res, err := deps.Cool18Service.GetHomePosts(r.Context(), mtid)
			if err != nil {
				httputil.JSONError(w, http.StatusBadGateway, err.Error())
				return
			}
			httputil.JSON(w, http.StatusOK, res, httputil.ListCacheHeaders)
		})

		r.Get("/books", func(w http.ResponseWriter, r *http.Request) {
			cid := r.URL.Query().Get("cid")
			if cid == "" {
				httputil.JSONError(w, http.StatusBadRequest, "missing cid parameter")
				return
			}
			chapterStr := r.URL.Query().Get("chapter")
			refresh := r.URL.Query().Get("refresh") == "1"

			if chapterStr != "" {
				ch, err := strconvAtoi(chapterStr)
				if err != nil {
					httputil.JSONError(w, http.StatusBadRequest, "invalid chapter")
					return
				}
				res, err := deps.XChinaService.GetChapter(r.Context(), cid, ch, refresh)
				if err != nil {
					httputil.JSONError(w, http.StatusInternalServerError, err.Error())
					return
				}
				headers := httputil.ContentCacheHeaders
				if refresh {
					headers = httputil.NoStoreHeaders
				}
				httputil.JSON(w, http.StatusOK, res, headers)
				return
			}

			res, err := deps.XChinaService.GetBook(r.Context(), cid, refresh)
			if err != nil {
				httputil.JSONError(w, http.StatusInternalServerError, err.Error())
				return
			}
			headers := httputil.ContentCacheHeaders
			if refresh {
				headers = httputil.NoStoreHeaders
			}
			httputil.JSON(w, http.StatusOK, res, headers)
		})

		r.Get("/categories", deps.Cool18Handler.HandleCategories)
		r.Get("/featured", deps.Cool18Handler.HandleFeatured)
		r.Get("/picks", deps.Cool18Handler.HandlePicks)
		r.Get("/comments", deps.Cool18Handler.HandleComments)
		r.Get("/trending", deps.Cool18Handler.HandleTrending)
		r.Get("/browse", func(w http.ResponseWriter, r *http.Request) {
			site := r.URL.Query().Get("site")
			if site == "2" {
				categoryType := r.URL.Query().Get("type")
				keywords := r.URL.Query().Get("q")
				page := 1
				if p, err := strconvAtoi(r.URL.Query().Get("page")); err == nil && p > 1 {
					page = p
				}
				res, err := deps.XChinaService.Browse(r.Context(), categoryType, keywords, page)
				if err != nil {
					httputil.JSONError(w, http.StatusInternalServerError, err.Error())
					return
				}
				httputil.JSON(w, http.StatusOK, res, httputil.ListCacheHeaders)
				return
			}
			deps.Cool18Handler.HandleBrowse(w, r)
		})
		r.Get("/search", NewSearchHandler(deps.Cool18Service, deps.XChinaService).HandleSearch)
	})

	// 2. 前端 SPA 静态托管及回退
	if deps.WebDist != "" {
		if _, err := os.Stat(deps.WebDist); err == nil {
			fileServer(r, "/", http.Dir(deps.WebDist))
		}
	}

	return r
}

func strconvAtoi(s string) (int, error) {
	var n int
	for _, ch := range s {
		if ch < '0' || ch > '9' {
			return 0, http.ErrNotSupported
		}
		n = n*10 + int(ch-'0')
	}
	return n, nil
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

