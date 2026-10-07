package main

import (
	"bytes"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"

	"coffe-mania/database/playerstate"
	"coffe-mania/shared/buildinfo"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"

	_ "coffe-mania/database/migrations"
)

func main() {
	app := pocketbase.New()
	playerstate.RegisterValidation(app)
	migratecmd.MustRegister(app, app.RootCmd, migratecmd.Config{Automigrate: false})
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.InstallerFunc = nil
		log.Printf("Coffe Mania %s: PocketBase", buildinfo.Version)
		registerSessionRoutes(e)
		registerPlayerStateRoutes(e)
		registerAppearanceRoutes(e)
		registerNpcAppearanceRoutes(e)
		if err := registerGameBridge(e); err != nil {
			return err
		}
		startRoomActivityWatchdog(e.App)
		registerCookingRoutes(e)
		registerRoomRoutes(e)
		publicDir := os.Getenv("COFFE_PUBLIC_DIR")
		if publicDir == "" {
			publicDir = "../game/dist"
		}
		publicDir, err := filepath.Abs(publicDir)
		if err != nil {
			return err
		}
		registerPageRoutes(e, publicDir)
		return e.Next()
	})
	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}

func registerPageRoutes(e *core.ServeEvent, publicDir string) {
	page := func(r *core.RequestEvent) error {
		r.Response.Header().Set("Cache-Control", "no-store")
		index, err := os.ReadFile(filepath.Join(publicDir, "index.html"))
		if err != nil || !bytes.Contains(index, []byte(`name="coffe-auth"`)) {
			return r.String(http.StatusServiceUnavailable, "Frontend indisponível ou desatualizado. Execute npm run build na raiz do projeto.")
		}
		return r.HTML(http.StatusOK, string(index))
	}
	play := func(r *core.RequestEvent) error {
		r.Response.Header().Set("Cache-Control", "no-store")
		if sessionRecord(r) == nil {
			clearSessionCookie(r)
			room := r.Request.URL.Query().Get("room")
			if room != "" {
				return r.Redirect(http.StatusSeeOther, "/?room="+url.QueryEscape(room))
			}
			return r.Redirect(http.StatusSeeOther, "/")
		}
		return page(r)
	}
	e.Router.GET("/{$}", page)
	e.Router.GET("/index.html", page)
	e.Router.GET("/play", play)
	e.Router.GET("/play/{$}", play)
	// Public art can be cached independently; only pages and game APIs carry user state.
	e.Router.GET("/{path...}", apis.Static(os.DirFS(publicDir), false))
}
