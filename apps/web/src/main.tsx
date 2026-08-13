import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { ConfirmProvider } from "@/components/confirm-dialog"
import { ThemeProvider } from "@/components/theme-provider"
import { ReadingSettingsProvider } from "@/components/reading-settings"
import { AuthGate, AuthProvider } from "@/lib/auth"
import { App } from "./App"
import "./index.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <ReadingSettingsProvider>
        <BrowserRouter>
          <AuthProvider>
            <ConfirmProvider>
              <AuthGate>
                <App />
              </AuthGate>
            </ConfirmProvider>
          </AuthProvider>
        </BrowserRouter>
      </ReadingSettingsProvider>
    </ThemeProvider>
  </StrictMode>
)
