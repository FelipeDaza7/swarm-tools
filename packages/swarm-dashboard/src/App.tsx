/**
 * Main App component - Swarm Dashboard
 * 
 * Architecture:
 * - SSE connection to localhost:3001/events for real-time updates
 * - AgentsPane and EventsPane derive state from SSE events (useMemo pattern)
 * - CellsPane polls REST API every 5s (useEffect pattern)
 * - Layout provides responsive 3-column grid
 */

import { Layout } from "./components";
import { AgentsPane } from "./components/AgentsPane";
import { EventsPane } from "./components/EventsPane";
import { CellsPane } from "./components/CellsPane";
import { useSwarmEvents } from "./hooks";
import "./App.css";

/**
 * Swarm Dashboard - Real-time multi-agent coordination UI
 * 
 * Shows:
 * - Active agents with current tasks (SSE-driven)
 * - Live event stream with filtering (SSE-driven)
 * - Cell hierarchy tree with status (REST polling)
 */
function App() {
  // Connect to SSE endpoint for real-time events
  const { events } = useSwarmEvents({
    url: "http://localhost:3001/events",
  });

  return (
    <Layout>
      {/* AgentsPane - derives agent status from events */}
      <AgentsPane />
      
      {/* EventsPane - shows live event stream */}
      <EventsPane events={events} />
      
      {/* CellsPane - polls REST API for cell tree */}
      <CellsPane />
    </Layout>
  );
}

export default App;
