import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig(({ command }) => ({
    plugins: [
        react(),
        VitePWA({
            disable: command === "serve",
            registerType: "autoUpdate",
            includeAssets: ["favicon.svg", "pwa-192.svg", "pwa-512.svg"],
            manifest: {
                name: "Restaurant Ordering System",
                short_name: "ROS",
                description: "Multilingual restaurant ordering system with realtime updates.",
                theme_color: "#111827",
                background_color: "#0b1020",
                display: "standalone",
                start_url: "/",
                lang: "ku",
                icons: [
                    {
                        src: "/pwa-192.svg",
                        sizes: "192x192",
                        type: "image/svg+xml",
                        purpose: "any"
                    },
                    {
                        src: "/pwa-512.svg",
                        sizes: "512x512",
                        type: "image/svg+xml",
                        purpose: "any"
                    }
                ]
            },
            workbox: {
                globPatterns: ["**/*.{js,css,html,svg,png,ico,json}"],
                runtimeCaching: [
                    {
                        urlPattern: ({ url }) => url.pathname.startsWith("/menu") || url.pathname.includes("/menu"),
                        handler: "StaleWhileRevalidate",
                        options: {
                            cacheName: "menu-data",
                            expiration: {
                                maxEntries: 20,
                                maxAgeSeconds: 60 * 60
                            }
                        }
                    }
                ]
            }
        })
    ],
    build: {
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (!id.includes("node_modules")) {
                        return;
                    }
                    if (id.includes("react") || id.includes("scheduler")) {
                        return "react-vendor";
                    }
                    if (id.includes("@tanstack/react-query")) {
                        return "query-vendor";
                    }
                    if (id.includes("react-router")) {
                        return "router-vendor";
                    }
                    if (id.includes("i18next") || id.includes("react-i18next")) {
                        return "i18n-vendor";
                    }
                    if (id.includes("socket.io-client") || id.includes("engine.io-client")) {
                        return "socket-vendor";
                    }
                    if (id.includes("lucide-react")) {
                        return "ui-vendor";
                    }
                    return "vendor";
                }
            }
        }
    },
    server: {
        port: 5173
    }
}));
