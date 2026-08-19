/* Asking the tutor service for a nudge.
 *
 * The whole exercise goes up with the request, reference solution included. That is only
 * reasonable because the browser already has it — see CLAUDE.md on why solutions ship —
 * and it means the service holds no content of its own to drift out of date.
 *
 * Available only where the platform is authenticated; on a local or open deployment there
 * is no API to call, and the affordance is hidden rather than failing.
 */
import { isEnabled, api } from './auth.js';

export const tutorAvailable = () => isEnabled();

export function askTutor({ course, exercise, step, submission, feedback }) {
  return api('hint', {
    method: 'POST',
    body: {
      course,
      exercise: exercise.id,
      title: exercise.title,
      prompt: exercise.prompt,
      instructions: step.instructions,
      solution: step.solution,
      submission,
      feedback,
    },
  });
}
