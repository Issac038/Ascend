function StatCard({
    label,
    value,
    unit,
    onClick
}) {
    return (
        <button
            className="stat-card stat-card-button"
            onClick={onClick}
        >
            <span className="stat-label">
                {label}
            </span>

            <strong>
                {value}
            </strong>

            <span className="stat-unit">
                {unit}
            </span>
        </button>
    );
}

export default StatCard;