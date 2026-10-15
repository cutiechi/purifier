package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

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

func main() {
	cfg := config.Load()
	log.Printf("[init] starting purifier backend on %s:%d (data: %s, oidc_enabled: %v)", cfg.Host, cfg.Port, cfg.DataDir, cfg.OidcEnabled)

	// 1. 初始化持久化存储 (SQLite / 未来一键平迁 PG)
	db, err := storage.OpenDB(cfg.DataDir)
	if err != nil {
		log.Fatalf("[fatal] failed to open database: %v", err)
	}
	defer db.Close()

	store := storage.NewStore(db)

	// 2. 初始化 Upstream Client (连接池 + 代理 + Singleflight)
	client := upstream.NewClient(cfg.ProxyURL, 15*time.Second)

	// 3. 初始化领域服务与 Handler
	cool18Svc := cool18.NewService(client, store, cfg.DataDir)
	cool18Hdl := cool18.NewHandler(cool18Svc)

	xchinaSvc := xchina.NewService(client, store, cfg.DataDir)
	xchinaHdl := xchina.NewHandler(xchinaSvc)

	// 4. 初始化 Jobs 异步任务执行引擎并注册任务
	runner := jobs.NewRunner(store)
	runner.Register(jobs.NewArchivePostsJob(cool18Svc, store))
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
		Addr:         fmt.Sprintf("%s:%d", cfg.Host, cfg.Port),
		Handler:      router,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// 7. 优雅停机监听
	go func() {
		log.Printf("[ready] server listening on http://%s:%d", cfg.Host, cfg.Port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[fatal] server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("[shutdown] shutting down server gracefully...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Fatalf("[shutdown] server forced to shutdown: %v", err)
	}
	log.Println("[shutdown] server exited safely")
}
