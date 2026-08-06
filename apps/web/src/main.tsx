import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { ThemeProvider } from "@/components/theme-provider"
import { ReadingSettingsProvider } from "@/components/reading-settings"
import { App } from "./App"
import "./index.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <ReadingSettingsProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ReadingSettingsProvider>
    </ThemeProvider>
  </StrictMode>
)
