import type { AppState } from '../types';
import type { View } from '../App';

interface Props {
  state: AppState;
  navigate: (v: View) => void;
}

// Flat-top hexagon in a 400×346 viewBox; nav lives on four of its vertices.
// The polygon IS the navigation — the app's name made literal.
const HEX_POINTS = '100,0 300,0 400,173 300,346 100,346 0,173';

interface VertexNav {
  view: View;
  label: string;
  countOf: (s: AppState) => number;
  // position of the label relative to the hex container, in % of its box
  style: React.CSSProperties;
}

const VERTICES: VertexNav[] = [
  {
    view: 'pursuits',
    label: 'Pursuits',
    countOf: (s) => s.pursuits.length,
    style: { left: '18%', top: '-3%', transform: 'translate(-100%, -50%)' },
  },
  {
    view: 'artifacts',
    label: 'Artifacts',
    countOf: (s) => s.artifacts.length,
    style: { left: '82%', top: '-3%', transform: 'translate(0, -50%)' },
  },
  {
    view: 'connections',
    label: 'Connections',
    countOf: (s) => s.connections.length,
    style: { left: '18%', top: '103%', transform: 'translate(-100%, -50%)' },
  },
  {
    view: 'map',
    label: 'Map',
    countOf: () => NaN,
    style: { left: '82%', top: '103%', transform: 'translate(0, -50%)' },
  },
];

export default function Home({ state, navigate }: Props) {
  return (
    <div className="home">
      <div className="hex-stage">
        <svg viewBox="-8 -8 416 362" className="hex-svg">
          <polygon points={HEX_POINTS} className="hex-shape" />
          {/* vertex dots — the four nav corners get filled markers */}
          <circle cx="100" cy="0" r="7" className="hex-dot" />
          <circle cx="300" cy="0" r="7" className="hex-dot" />
          <circle cx="100" cy="346" r="7" className="hex-dot" />
          <circle cx="300" cy="346" r="7" className="hex-dot" />
          <circle cx="0" cy="173" r="3.5" className="hex-dot faint" />
          <circle cx="400" cy="173" r="3.5" className="hex-dot faint" />
        </svg>

        <div className="hex-center">
          <div className="hex-wordmark">POLYGON</div>
          <div className="hex-tagline">many sides, one mind</div>
        </div>

        {VERTICES.map((v) => {
          const n = v.countOf(state);
          return (
            <button key={v.view} className="vertex-nav" style={v.style} onClick={() => navigate(v.view)}>
              <span className="vertex-label">{v.label}</span>
              {!Number.isNaN(n) && <span className="vertex-count">{n}</span>}
            </button>
          );
        })}
      </div>
      <p className="home-hint">
        pick a vertex — or the ☰ if hexagons aren't your thing yet
      </p>
    </div>
  );
}
