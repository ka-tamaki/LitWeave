import {fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vitest";
import {ThemeProvider, useTheme} from "./theme";

function ThemeControl() {
  const {theme, toggleTheme} = useTheme();
  return <button onClick={toggleTheme}>{theme}</button>;
}

describe("カラーテーマ", () => {
  afterEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = "";
  });

  it("保存済みのテーマを読み込み、切替結果を保持する", async () => {
    window.localStorage.setItem("litweave-color-theme", "dark");
    render(<ThemeProvider><ThemeControl /></ThemeProvider>);

    expect(screen.getByRole("button", {name: "dark"})).toBeInTheDocument();
    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "dark"));

    fireEvent.click(screen.getByRole("button", {name: "dark"}));

    expect(screen.getByRole("button", {name: "light"})).toBeInTheDocument();
    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute("data-theme", "light");
      expect(window.localStorage.getItem("litweave-color-theme")).toBe("light");
    });
  });
});
