package main

import (
	"net/http"

	"coffe-mania/database/appearance"
	"coffe-mania/database/playerstate"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

func registerAppearanceRoutes(e *core.ServeEvent) {
	e.Router.POST("/api/coffe/appearance", func(r *core.RequestEvent) error {
		r.Response.Header().Set("Cache-Control", "no-store")
		user := sessionRecord(r)
		if user == nil {
			clearSessionCookie(r)
			return r.UnauthorizedError("Entre para jogar.", nil)
		}
		var data struct {
			Appearance string `json:"appearance"`
		}
		if err := r.BindBody(&data); err != nil {
			return r.BadRequestError("Visual inválido.", nil)
		}
		value, err := appearance.Validate(data.Appearance)
		if err != nil {
			return r.BadRequestError("Visual inválido.", nil)
		}
		if _, err := playerstate.GetOrCreate(r.App, user.Id); err != nil {
			return r.InternalServerError("Não foi possível salvar o visual.", err)
		}
		// Refetch inside the transaction to preserve concurrent economy/HUD changes.
		var state playerstate.Snapshot
		err = r.App.RunInTransaction(func(tx core.App) error {
			record, err := tx.FindFirstRecordByData(playerstate.Collection, "user", user.Id)
			if err != nil {
				return err
			}
			record.Set("appearance", value)
			if err := tx.Save(record); err != nil {
				return err
			}
			state = playerstate.View(record)
			return nil
		})
		if err != nil {
			return r.InternalServerError("Não foi possível salvar o visual.", err)
		}
		if client := roomService(r.App); client != nil {
			if err := client.request(r.Request.Context(), "appearance", map[string]string{"User": user.Id, "Appearance": value}, nil); err != nil {
				r.App.Logger().Warn("Visual salvo; instância indisponível", "error", err)
			}
		}
		return r.JSON(http.StatusOK, state)
	}).Bind(apis.BodyLimit(8192)).BindFunc(sameOrigin)
}
