package main

import (
	"coffe-mania/game-server/gameruntime"
	"coffe-mania/shared/buildinfo"
	"coffe-mania/shared/gamewire"
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	secret, err := gamewire.Secret(false)
	if err != nil {
		log.Fatal("Chave do jogo indisponível. Inicie o PocketBase primeiro: ", err)
	}
	backend := os.Getenv("COFFE_BACKEND_URL")
	if backend == "" {
		backend = "http://127.0.0.1:8090"
	}
	addr := os.Getenv("COFFE_GAME_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8091"
	}
	manager := gameruntime.New(&gameruntime.HTTPStorage{URL: backend, Secret: secret}, gameruntime.Options{})
	runtimeServer := gameruntime.NewServer(manager, secret)
	server := &http.Server{Addr: addr, Handler: runtimeServer.Handler(), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second}
	runtimeServer.Shutdown = func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}
	stopped := make(chan os.Signal, 1)
	signal.Notify(stopped, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-stopped
		ctx, cancel := context.WithTimeout(context.Background(), 35*time.Second)
		defer cancel()
		if err := manager.Close(ctx); err != nil {
			log.Printf("Final room save failed: %v", err)
		}
		_ = server.Shutdown(ctx)
	}()
	log.Printf("Coffe Mania %s: instâncias Go disponíveis em %s", buildinfo.Version, addr)
	if err = server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
