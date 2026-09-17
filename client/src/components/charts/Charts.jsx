// Monochrome SVG charts — black/grey/white only.

export function LineChart({ data, height = 180, formatX = (d) => d.label }) {
    const width = 600;
    const pad = { top: 14, right: 8, bottom: 24, left: 8 };
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;

    const points = data
        .map((d, i) => ({ ...d, x: pad.left + (i / Math.max(1, data.length - 1)) * innerW }))
        .filter((p) => p.value !== null && p.value !== undefined);

    if (points.length === 0) {
        return (
            <div style={{ color: "var(--text-4)", fontSize: 12.5, padding: "30px 0", textAlign: "center" }}>
                Not enough data yet. Complete a few days first.
            </div>
        );
    }

    const y = (v) => pad.top + innerH - (v / 100) * innerH;

    const linePts = points.map((p) => `${p.x},${y(p.value)}`).join(" ");
    const areaPts = `${pad.left},${pad.top + innerH} ${linePts} ${points[points.length - 1].x},${pad.top + innerH}`;
    const last = points[points.length - 1];

    return (
        <svg className="line-chart" viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="Score trend chart">
            {[0, 25, 50, 75, 100].map((v) => (
                <line key={v} className="grid-line" x1={pad.left} x2={width - pad.right} y1={y(v)} y2={y(v)} />
            ))}
            <path className="area" d={`M ${areaPts} Z`} />
            <polyline className="line" points={linePts} fill="none" />
            <circle className="dot" cx={last.x} cy={y(last.value)} r={3.5} />
            {points.filter((_, i) => i % Math.max(1, Math.ceil(points.length / 6)) === 0).map((p, i) => (
                <text key={i} x={p.x} y={height - 6} textAnchor="middle">{formatX(p)}</text>
            ))}
        </svg>
    );
}

export function BarChart({ data, height = 180, formatX = (d) => d.label, suffix = "" }) {
    const width = 600;
    const pad = { top: 12, right: 8, bottom: 24, left: 8 };
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;

    if (!data.length) {
        return (
            <div style={{ color: "var(--text-4)", fontSize: 12.5, padding: "30px 0", textAlign: "center" }}>
                No data in this range yet.
            </div>
        );
    }

    const max = Math.max(...data.map((d) => d.value ?? 0), 1);
    const slot = innerW / data.length;
    const barW = Math.max(6, Math.min(46, slot * 0.55));

    return (
        <svg className="bar-chart" viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="Bar chart">
            <line className="grid-line" x1={pad.left} x2={width - pad.right} y1={pad.top + innerH} y2={pad.top + innerH} stroke="#1f1f1f" />
            {data.map((d, i) => {
                const x = pad.left + i * slot + (slot - barW) / 2;
                const v = d.value ?? 0;
                const h = (v / max) * innerH;
                return (
                    <g key={i}>
                        <rect
                            className={v > 0 ? "bar-rect" : "bar-zero"}
                            x={x}
                            y={pad.top + innerH - h}
                            width={barW}
                            height={Math.max(2, h)}
                            rx={3}
                        >
                            <title>{`${d.label ?? ""} ${v}${suffix}`}</title>
                        </rect>
                        {i % Math.max(1, Math.ceil(data.length / 7)) === 0 && (
                            <text x={x + barW / 2} y={height - 6} textAnchor="middle">{formatX(d)}</text>
                        )}
                    </g>
                );
            })}
        </svg>
    );
}

export function MiniBars({ values = [] }) {
    const max = Math.max(...values.map((v) => v ?? 0), 1);
    return (
        <div className="mini-bars" aria-hidden="true">
            {values.map((v, i) => (
                <div
                    key={i}
                    className={`bar${v !== null && v !== undefined ? " has" : ""}`}
                    style={{ height: v === null || v === undefined ? 4 : `${Math.max(6, (v / max) * 100)}%` }}
                    title={v !== null && v !== undefined ? `${v}%` : "rest day"}
                />
            ))}
        </div>
    );
}
