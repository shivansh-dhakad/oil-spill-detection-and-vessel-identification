import { Routes, Route, useLocation } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import Header from "./components/Header.jsx";
import AmbientField from "./components/AmbientField.jsx";
import PageTransition from "./components/PageTransition.jsx";
import NewPrediction from "./pages/NewPrediction.jsx";
import PredictionResults from "./pages/PredictionResults.jsx";
import PredictionHistory from "./pages/PredictionHistory.jsx";
import BatchProcessing from "./pages/BatchProcessing.jsx";
import IncidentManagement from "./pages/IncidentManagement.jsx";

export default function App() {
  const location = useLocation();

  return (
    <div className="relative min-h-screen text-slate-body font-body antialiased">
      <AmbientField />
      <div className="relative z-10">
        <Header />
        <AnimatePresence mode="wait">
          <Routes location={location} key={location.pathname}>
            <Route path="/" element={<PageTransition><NewPrediction /></PageTransition>} />
            <Route path="/results/:id" element={<PageTransition><PredictionResults /></PageTransition>} />
            <Route path="/history" element={<PageTransition><PredictionHistory /></PageTransition>} />
            <Route path="/batch" element={<PageTransition><BatchProcessing /></PageTransition>} />
            <Route path="/incidents" element={<PageTransition><IncidentManagement /></PageTransition>} />
          </Routes>
        </AnimatePresence>
      </div>
    </div>
  );
}
