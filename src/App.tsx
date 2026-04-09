import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { EngagementBackdrop } from "@/components/EngagementBackdrop";
import { metaPixelPageView } from "@/lib/meta-pixel";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index";
import PurchasePage from "./pages/PurchasePage";
import AdminPage from "./pages/AdminPage";
import TutorialCurtidas from "./pages/TutorialCurtidas";
import EngajamentoPage from "./pages/EngajamentoPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function MetaPixelPageViews() {
  const { pathname } = useLocation();
  useEffect(() => {
    metaPixelPageView();
  }, [pathname]);
  return null;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <MetaPixelPageViews />
        <EngagementBackdrop />
        <div className="relative z-10 min-h-[100svh] w-full min-w-0 max-w-full overflow-x-hidden md:min-h-[100dvh] md:min-h-screen">
          <Routes>
            <Route path="/" element={<Navigate to="/seg" replace />} />
            <Route path="/seg" element={<Index />} />
            <Route path="/curtidas" element={<Navigate to="/seg" replace />} />
            <Route path="/views" element={<Navigate to="/seg" replace />} />
            <Route path="/engajamento" element={<EngajamentoPage />} />
            <Route path="/tutorial/curtidas" element={<TutorialCurtidas />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/:slug" element={<PurchasePage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
