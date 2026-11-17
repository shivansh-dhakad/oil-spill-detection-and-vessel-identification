import { motion } from "framer-motion";

// Opacity-only fade-in. No vertical slide (it fought with the sticky hero and
// the fixed header) and no exit animation (see App.jsx).
const variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.25, ease: "easeOut" } },
};

/** Wraps a route's page so navigating between routes fades in instead of hard-cutting. */
export default function PageTransition({ children }) {
  return (
    <motion.div variants={variants} initial="initial" animate="animate">
      {children}
    </motion.div>
  );
}