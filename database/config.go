package main

import "os"

// Use behind an HTTPS reverse proxy, where Go receives the internal HTTP connection.
func osSecureCookies() bool { return os.Getenv("COFFE_SECURE_COOKIES") == "true" }
