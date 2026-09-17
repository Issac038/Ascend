function HabitCard({
    name,
    icon,
    completed,
    danger,
    onClick
}) {
    return (
        <button
            className={`habit ${
                completed ? "completed" : ""
            } ${danger ? "danger" : ""}`}
            onClick={onClick}
        >
            <div className="habit-top">

                <span className="habit-icon">
                    {icon}
                </span>

                <span className="habit-indicator">
                    {completed ? "✓" : ""}
                </span>

            </div>

            <span className="habit-name">
                {name}
            </span>

            <span className="habit-status">
                {completed
                    ? "COMPLETED"
                    : "MARK COMPLETE"}
            </span>

        </button>
    );
}

export default HabitCard;