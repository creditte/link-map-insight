import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import ErrorBoundary from "@/components/ErrorBoundary";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/AppLayout";
import Auth from "./pages/Auth";
import Signup from "./pages/Signup";
import Login from "./pages/Login";
import MfaSetup from "./pages/MfaSetup";
import MfaVerify from "./pages/MfaVerify";
import Onboarding from "./pages/Onboarding";
import Dashboard from "./pages/Dashboard";
import Structures from "./pages/Structures";
import StructureView from "./pages/StructureView";
import Import from "./pages/Import";
import Review from "./pages/Review";
import SettingsPage from "./pages/SettingsPage";
import NotFound from "./pages/NotFound";
import StructureCompare from "./pages/StructureCompare";
import ClientGovernance from "./pages/ClientGovernance";
import SetupPassword from "./pages/SetupPassword";
import ProtectedAdminRoute from "@/components/ProtectedAdminRoute";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminTenantDetail from "./pages/admin/AdminTenantDetail";

const queryClient = new QueryClient();

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              <Route path="/auth" element={<Auth />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/login" element={<Login />} />
              <Route path="/mfa-setup" element={<MfaSetup />} />
              <Route path="/mfa-verify" element={<MfaVerify />} />
              <Route path="/onboarding" element={<Onboarding />} />
              <Route path="/setup-password" element={<SetupPassword />} />
              {/* Super Admin routes */}
              <Route path="/admin" element={<ProtectedAdminRoute><AdminDashboard /></ProtectedAdminRoute>} />
              <Route path="/admin/tenants/:tenantId" element={<ProtectedAdminRoute><AdminTenantDetail /></ProtectedAdminRoute>} />
              <Route
                element={
                  <ProtectedRoute>
                    <AppLayout />
                  </ProtectedRoute>
                }
              >
                <Route path="/" element={<Dashboard />} />
                <Route path="/structures" element={<Structures />} />
                <Route path="/structures/:id" element={<StructureView />} />
                <Route path="/structures/:id/compare" element={<StructureCompare />} />
                <Route path="/import" element={<Import />} />
                <Route path="/review" element={<Review />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/governance" element={<ClientGovernance />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
