import { useLayoutEffect } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import Header from "./components/Header.jsx";
import AmbientField from "./components/AmbientField.jsx";
import GradientWaves from "./components/GradientWaves.jsx";
import PageTransition from "./components/PageTransition.jsx";
import NewPrediction from "./pages/NewPrediction.jsx";
import PredictionResults from "./pages/PredictionResults.jsx";
import PredictionHistory from "./pages/PredictionHistory.jsx";
import BatchProcessing from "./pages/BatchProcessing.jsx";
import IncidentManagement from "./pages/IncidentManagement.jsx";

// Routes that use the light "paper" theme (dashboard.css). Keep in sync with
// the `light` flag in components/Header.jsx.
const LIGHT_ROUTES = ["/", "/history", "/batch"];
// The results page (/results/:id) shares the light survey-chart theme.
const isLightPath = (p) => LIGHT_ROUTES.includes(p) || p.startsWith("/results/");

export default function App() {
  const location = useLocation();
  const isLight = isLightPath(location.pathname);

  // useLayoutEffect runs before the browser paints, so the body background
  // flips in the same frame as the route change (no flash of the old theme).
  // Scroll is reset so the dashboard's sticky hero never opens mid-scroll.
  useLayoutEffect(() => {
    document.body.classList.toggle("lt-body", isLight);
    window.scrollTo(0, 0);
    return () => document.body.classList.remove("lt-body");
  }, [isLight, location.pathname]);

  return (
    <div className="relative min-h-screen text-slate-body font-body antialiased">
      {/* Dark animated backdrops are skipped on light pages - they'd sit
          hidden behind the opaque paper page and just burn CPU. */}
      {!isLight && (
        <>
          <GradientWaves
            horizonColor="#071923"
            waveColor="#0e7490"
            crestColor="#67e8f9"
            speed={0.4}
            amplitude={2.5}
            waveScale={0.6}
            waveRatio={0.9}
            swell={35}
            turbulence={20}
            tilt={1.11}
            zoom={1}
            height={5.5}
            fogDepth={15}
            detail="medium"
            brightness={0.9}
            opacity={0.72}
            mouseInteraction
            parallaxStrength={0.5}
            grain
            grainIntensity={0.05}
          />
          <AmbientField />
        </>
      )}
      <div className="relative z-10">
        <Header />
        {/* No AnimatePresence / exit animation: the body theme has already
            switched, so a fading-out old page would sit on the wrong
            background. The new page simply fades in (see PageTransition). */}
        <Routes location={location}>
          <Route path="/" element={<PageTransition key="dashboard"><NewPrediction /></PageTransition>} />
          <Route path="/results/:id" element={<PageTransition key="results"><PredictionResults /></PageTransition>} />
          <Route path="/history" element={<PageTransition key="history"><PredictionHistory /></PageTransition>} />
          <Route path="/batch" element={<PageTransition key="batch"><BatchProcessing /></PageTransition>} />
          <Route path="/incidents" element={<PageTransition key="incidents"><IncidentManagement /></PageTransition>} />
        </Routes>
      </div>
    </div>
  );
}