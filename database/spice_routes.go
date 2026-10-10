package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"coffe-mania/database/playerstate"
	"github.com/google/uuid"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

func registerSpicePurchaseRoutes(e *core.ServeEvent) {
	e.Router.POST("/api/coffe/cooking/spices/purchase", func(r *core.RequestEvent) error {
		r.Response.Header().Set("Cache-Control", "no-store")
		user := sessionRecord(r)
		if user == nil {
			return r.UnauthorizedError("Entre para jogar.", nil)
		}
		if !strings.HasPrefix(r.Request.Header.Get("Content-Type"), "application/json") {
			return r.BadRequestError("Envie JSON.", nil)
		}
		var body struct {
			Spice     string `json:"spice"`
			RequestID string `json:"requestId"`
		}
		decoder := json.NewDecoder(r.Request.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&body); err != nil {
			return r.BadRequestError("Pedido inválido.", nil)
		}
		if err := decoder.Decode(new(any)); err != io.EOF {
			return r.BadRequestError("Pedido inválido.", nil)
		}
		if _, err := uuid.Parse(body.RequestID); err != nil {
			return r.BadRequestError("Identificador inválido.", nil)
		}
		if err := purchaseSpice(r.App, user.Id, body.Spice, body.RequestID); err != nil {
			switch {
			case errors.Is(err, errUnknownSpice):
				return r.BadRequestError(err.Error(), nil)
			case errors.Is(err, errNoCash), errors.Is(err, errSpicePurchaseConflict), errors.Is(err, errSpiceStockLimit):
				return apis.NewApiError(http.StatusConflict, err.Error(), nil)
			default:
				return r.InternalServerError("Não foi possível comprar o tempero.", err)
			}
		}
		state, err := playerstate.GetOrCreate(r.App, user.Id)
		if err != nil {
			return r.InternalServerError("Compra salva; recarregue para atualizar o estoque.", err)
		}
		return r.JSON(http.StatusOK, playerstate.View(state))
	}).Bind(apis.BodyLimit(1024)).BindFunc(func(r *core.RequestEvent) error {
		if r.Request.Header.Get("Origin") == "" {
			return r.ForbiddenError("Origem inválida.", nil)
		}
		return sameOrigin(r)
	})
}
