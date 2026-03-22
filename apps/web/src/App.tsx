import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "./providers/auth-provider";
import { LoginPage } from "./features/auth/login-page";
import { CustomerAboutMorePage, CustomerAboutPage, CustomerCategorySettingsDetailPage, CustomerDashboard, CustomerMenuItemSettingsDetailPage, CustomerOrderDetailPage, CustomerSettingsPage } from "./features/customer/customer-dashboard";
import { AdminCategoryEditorPage, AdminDashboard, AdminMenuItemEditorPage } from "./features/admin/admin-dashboard";

const Splash = () => (
  <div className="app-shell flex items-center justify-center">
    <div className="app-panel px-6 py-5 text-center">
      <p className="font-display text-xl font-bold sm:text-2xl">Loading dashboard...</p>
    </div>
  </div>
);

const Protected = ({ roles, children }: { roles?: Array<"CUSTOMER" | "ADMIN">; children: ReactNode }) => {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <Splash />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to={user.role === "ADMIN" ? "/admin" : "/app"} replace />;
  return <>{children}</>;
};

const LoginRoute = () => {
  const { user, isLoading } = useAuth();
  if (isLoading) return <Splash />;
  if (user) return <Navigate to={user.role === "ADMIN" ? "/admin" : "/app"} replace />;
  return <LoginPage />;
};

export const App = () => (
  <Routes>
    <Route path="/" element={<Navigate to="/login" replace />} />
    <Route path="/login" element={<LoginRoute />} />
    <Route path="/app" element={<Protected roles={["CUSTOMER"]}><CustomerDashboard /></Protected>} />
    <Route path="/app/about" element={<Protected roles={["CUSTOMER"]}><CustomerAboutPage /></Protected>} />
    <Route path="/app/about/more" element={<Protected roles={["CUSTOMER"]}><CustomerAboutMorePage /></Protected>} />
    <Route path="/app/settings" element={<Protected roles={["CUSTOMER"]}><CustomerSettingsPage /></Protected>} />
    <Route path="/app/settings/categories/:categoryId" element={<Protected roles={["CUSTOMER"]}><CustomerCategorySettingsDetailPage /></Protected>} />
    <Route path="/app/settings/menu-items/:itemId" element={<Protected roles={["CUSTOMER"]}><CustomerMenuItemSettingsDetailPage /></Protected>} />
    <Route path="/app/orders/:orderId" element={<Protected roles={["CUSTOMER"]}><CustomerOrderDetailPage /></Protected>} />
    <Route path="/admin/categories/new" element={<Protected roles={["ADMIN"]}><AdminCategoryEditorPage /></Protected>} />
    <Route path="/admin/categories/:categoryId" element={<Protected roles={["ADMIN"]}><AdminCategoryEditorPage /></Protected>} />
    <Route path="/admin/menu-items/new" element={<Protected roles={["ADMIN"]}><AdminMenuItemEditorPage /></Protected>} />
    <Route path="/admin/menu-items/:itemId" element={<Protected roles={["ADMIN"]}><AdminMenuItemEditorPage /></Protected>} />
    <Route path="/admin" element={<Protected roles={["ADMIN"]}><AdminDashboard /></Protected>} />
    <Route path="*" element={<Navigate to="/login" replace />} />
  </Routes>
);
