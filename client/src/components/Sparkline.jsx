/** Plain-SVG sparkline with a ±500 ms reference band. */
export default function Sparkline({ values, width = 160, height = 36, limit = 500 }) {
  if (!values.length) return <svg width={width} height={height} role="img" aria-label="no data" />;
  const maxAbs = Math.max(limit, ...values.map((v) => Math.abs(v)));
  const y = (v) => height / 2 - (v / maxAbs) * (height / 2 - 2);
  const x = (i) => (values.length === 1 ? width : (i / (values.length - 1)) * width);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values[values.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`drift trend, latest ${last} ms`} className="sparkline">
      <rect x="0" y={y(limit)} width={width} height={y(-limit) - y(limit)} className="spark-band" />
      <line x1="0" x2={width} y1={height / 2} y2={height / 2} className="spark-zero" />
      <path d={d} className="spark-line" fill="none" />
      <circle cx={x(values.length - 1)} cy={y(last)} r="2.5" className="spark-dot" />
    </svg>
  );
}
