import { useToast } from '../context/ToastContext.jsx';

/** Feature B: one click hard-syncs the local player to the room position. */
export default function CatchUpButton({ controller, disabled }) {
  const toast = useToast();
  return (
    <button
      type="button"
      className="btn"
      disabled={disabled}
      title="Jump to exactly where the room is"
      onClick={() => {
        const before = controller.currentTime();
        const pos = controller.hardSeekToExpected();
        if (controller.serverState?.playing) controller.sync('catch-up');
        const delta = pos - before;
        toast.push({ text: `Caught up ${Math.abs(delta) < 0.05 ? '(you were already in sync)' : `(${delta > 0 ? '+' : ''}${delta.toFixed(2)} s)`}`, type: 'success', key: 'catchup' });
      }}
    >
      ⚡ Catch me up
    </button>
  );
}
