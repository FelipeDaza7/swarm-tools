/**
 * Example eval file to test Evalite setup
 *
 * This is a minimal test to verify:
 * 1. Evalite CLI can discover .eval.ts files
 * 2. createScorer works
 * 3. evalite() function works
 */

import { evalite } from "evalite";
import { subtaskIndependence } from "./scorers/index.js";

evalite("Example: Basic scorer test", {
  data: async () => {
    return [
      {
        input: "Test task",
        output: JSON.stringify({
          epic: { title: "Test Epic", description: "Test" },
          subtasks: [
            { title: "Subtask 1", files: ["a.ts"], estimated_complexity: 1 },
            { title: "Subtask 2", files: ["b.ts"], estimated_complexity: 1 },
          ],
        }),
      },
    ];
  },
  task: async (input) => {
    return input; // passthrough for testing
  },
  scorers: [subtaskIndependence],
});
