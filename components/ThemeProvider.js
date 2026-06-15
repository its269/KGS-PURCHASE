"use client";

import { createContext, useContext, useEffect, useState } from "react";

const ThemeContext = createContext();
export function ThemeProvider({ children }) {
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [mounted, setMounted] = useState(false);

    // Initial load - check localStorage and system preference
    useEffect(() => {
        const savedTheme = localStorage.getItem("theme");
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        const shouldBeDark = savedTheme === "dark" || (!savedTheme && prefersDark);

        setIsDarkMode(shouldBeDark);
        setMounted(true);
    }, []);

    // Apply theme changes to the document
    useEffect(() => {
        if (!mounted) return;

        if (isDarkMode) {
            document.documentElement.setAttribute("data-theme", "dark");
            localStorage.setItem("theme", "dark");
        } else {
            document.documentElement.setAttribute("data-theme", "light");
            localStorage.setItem("theme", "light");
        }
    }, [isDarkMode, mounted]);

    const toggleTheme = () => setIsDarkMode(prev => !prev);

    // Context value
    const value = {
        isDarkMode,
        toggleTheme,
        mounted
    };

    return (
        <ThemeContext.Provider value={value}>
            {children}
        </ThemeContext.Provider>
    );
}

export const useTheme = () => useContext(ThemeContext);
