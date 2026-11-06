package main

import (
	"context"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"
	_ "time/tzdata" // 内嵌 tzdata：镜像里没有 zoneinfo 时 TZ 名仍可解析

	"purifier/internal/api"
	"purifier/internal/api/auth"
	"purifier/internal/api/me"
	internalAuth "purifier/internal/auth"
	"purifier/internal/config"
	"purifier/internal/core/upstream"
	"purifier/internal/jobs"
	"purifier/internal/provider/cool18"
	"purifier/internal/provider/xchina"
	"purifier/internal/storage"
)

// resolveLocal 让进程本地时区与 TZ 一致。
// Go 在 TZ 设为时区名时只查 zoneinfo；镜像里 tzdata 被 apk del 后
// LoadLocation 会失败并静默退回 UTC，导致统计按 UTC 日切。
func resolveLocal(tz string) *time.Location {
	if tz == "" {
		tz = "Asia/Shanghai"
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		log.Printf("[init] WARN: cannot load timezone %q (%v); falling back to %s", tz, err, time.Local)
		return time.Local
	}
	time.Local = loc
	return loc
}

func main() {
	cfg := config.Load()
	addr := net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port))
	loc := resolveLocal(cfg.TZ)
	_, offset := time.Now().In(loc).Zone()
	log.Printf("[init] starting purifier backend on %s (data: %s, oidc_enabled: %v)", addr, cfg.DataDir, cfg.OidcEnabled)
	log.Printf("[init] timezone: TZ=%s time.Local=%s utc_offset=%ds", cfg.TZ, loc, offset)

	// 1. 初始化持久化存储 (SQLite / 未来一键平迁 PG)
	db, err := storage.OpenDB(cfg.DataDir)
	if err != nil {
		log.Fatalf("[fatal] failed to open database: %v", err)
	}
	defer db.Close()

	store := storage.NewStore(db)

	// 2. 初始化 Upstream Client (连接池 + 代理 + Singleflight)
	// xbookcn 标签/搜索页实测抖动 5–40s；30s 覆盖正常抖动且不永久挂住请求
	client := upstream.NewClient(cfg.ProxyURL, 30*time.Second)

	// 3. 初始化领域服务与 Handler
	cool18Svc := cool18.NewService(client, store, cfg.DataDir)
	cool18Hdl := cool18.NewHandler(cool18Svc)

	xchinaSvc := xchina.NewService(client, store, cfg.DataDir)
	xchinaHdl := xchina.NewHandler(xchinaSvc)

	// 4. 初始化 Jobs 异步任务执行引擎并注册任务
	runner := jobs.NewRunner(store)
	runner.Register(jobs.NewArchivePostsJob(cool18Svc, store))
	runner.Register(jobs.NewArchiveBooksJob(xchinaSvc, store))
	runner.Register(jobs.NewArchiveAutoGroupJob(store))
	runner.Register(jobs.NewArchiveLinkedJob(cool18Svc, store))
	runner.RecoverOnStartup(context.Background())

	meHdl := me.NewHandler(store, runner, cfg.DataDir).Routes()

	// 5. 初始化 OIDC 认证鉴权
	authSvc := internalAuth.NewService(cfg)
	authHdl := auth.NewHandler(cfg, authSvc)

	// 6. 装配总路由
	router := api.SetupRouter(api.RouterDependencies{
		Store:         store,
		Cool18Handler: cool18Hdl,
		Cool18Service: cool18Svc,
		XChinaHandler: xchinaHdl,
		XChinaService: xchinaSvc,
		MeHandler:     meHdl,
		AuthHandler:   authHdl,
		WebDist:       cfg.WebDist,
	})

	server := &http.Server{
		Addr:         addr,
		Handler:      router,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// 7. 优雅停机监听
	go func() {
		log.Printf("[ready] server listening on http://%s", addr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[fatal] server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("[shutdown] shutting down server gracefully...")

	// 先停任务，让归档在写库前收尾；否则进程退出会把任务丢在半页之间。
	stopped := runner.StopAll()
	if stopped > 0 {
		log.Printf("[shutdown] requested stop for %d running job(s)", stopped)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Printf("[shutdown] server forced to shutdown: %v", err)
	}
	runner.Wait(8 * time.Second)
	log.Println("[shutdown] server exited safely")
}
