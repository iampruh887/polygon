import { useEffect, useState } from 'react';
import { api } from '../api';

type Category = 'bug' | 'idea' | 'other';
const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'bug', label: 'Bug' },
  { key: 'idea', label: 'Idea' },
  { key: 'other', label: 'Other' },
];

// Floating feedback button + modal, present on every signed-in page. Stores to
// the feedback table and (if configured) pings the maker's Telegram.
export default function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Category>('idea');
  const [rating, setRating] = useState(0);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function reset() {
    setCategory('idea');
    setRating(0);
    setMessage('');
    setStatus('idle');
    setError(null);
  }

  async function submit() {
    if (!message.trim() || rating === 0) return;
    setStatus('sending');
    setError(null);
    try {
      await api.submitFeedback(category, rating, message.trim());
      setStatus('sent');
      setTimeout(() => {
        setOpen(false);
        reset();
      }, 1400);
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : 'Could not send feedback');
    }
  }

  return (
    <>
      <button className="feedback-fab" onClick={() => setOpen(true)} title="Send feedback">
        ✎ Feedback
      </button>

      {open && (
        <div className="feedback-overlay" onClick={() => setOpen(false)}>
          <div className="feedback-card" onClick={(e) => e.stopPropagation()}>
            <div className="feedback-head">
              <h2>Send feedback</h2>
              <button className="btn ghost" onClick={() => setOpen(false)}>
                ×
              </button>
            </div>

            {status === 'sent' ? (
              <p className="feedback-thanks">Thanks — got it. ⬡</p>
            ) : (
              <>
                <div className="feedback-field-label">What kind?</div>
                <div className="feedback-cats">
                  {CATEGORIES.map((c) => (
                    <button
                      key={c.key}
                      className={`feedback-cat ${category === c.key ? 'active' : ''}`}
                      onClick={() => setCategory(c.key)}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>

                <div className="feedback-field-label">How's it feeling?</div>
                <div className="feedback-stars">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      className={`feedback-star ${n <= rating ? 'on' : ''}`}
                      onClick={() => setRating(n)}
                      title={`${n} / 5`}
                      aria-label={`${n} out of 5`}
                    >
                      ★
                    </button>
                  ))}
                </div>

                <textarea
                  className="feedback-message"
                  placeholder="What's on your mind? Bugs, ideas, whatever."
                  value={message}
                  maxLength={4000}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void submit();
                  }}
                />

                {error && <div className="notice" style={{ marginBottom: 10 }}>{error}</div>}

                <button
                  className="btn primary feedback-send"
                  disabled={status === 'sending' || !message.trim() || rating === 0}
                  onClick={() => void submit()}
                >
                  {status === 'sending' ? 'Sending…' : 'Send'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
