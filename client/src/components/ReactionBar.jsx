import { forwardRef } from 'react';
import { EMOJIS } from '../utils/emojis.js';

/** Emoji buttons under the player. Press "R" to jump focus here, then arrows + Enter. */
const ReactionBar = forwardRef(function ReactionBar({ onReact, highlight }, ref) {
  return (
    <div className={`reaction-bar ${highlight ? 'highlight' : ''}`} role="toolbar" aria-label="Send a reaction" ref={ref}>
      {EMOJIS.map((e) => (
        <button
          key={e}
          type="button"
          className="reaction-btn"
          onClick={() => onReact(e)}
          aria-label={`React ${e}`}
          onKeyDown={(ev) => {
            const btns = [...ev.currentTarget.parentElement.querySelectorAll('button')];
            const i = btns.indexOf(ev.currentTarget);
            if (ev.key === 'ArrowRight') btns[(i + 1) % btns.length].focus();
            if (ev.key === 'ArrowLeft') btns[(i - 1 + btns.length) % btns.length].focus();
          }}
        >
          {e}
        </button>
      ))}
    </div>
  );
});

export default ReactionBar;
