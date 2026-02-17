import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/AppLayout";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Structures from "./pages/Structures";
import StructureView from "./pages/StructureView";
import Import from "./pages/Import";
import Review from "./pages/Review";
import SettingsPage from "./pages/SettingsPage";
import NotFound from "./pages/NotFound";
import StructureCompare from "./pages/StructureCompare";
import ClientGovernance from "./pages/ClientGovernance";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/auth" element={<Auth />} />
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
);

export default App;
