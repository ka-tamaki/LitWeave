import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import {applyTheme, initialTheme, ThemeProvider} from "./theme";
import "./styles.css";
import "./theme.css";
import "./keyword-selector.css";

applyTheme(initialTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode><ThemeProvider><BrowserRouter><App /></BrowserRouter></ThemeProvider></StrictMode>,
);
