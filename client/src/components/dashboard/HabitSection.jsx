import HabitCard from "./HabitCard";

function HabitSection({
    number,
    title,
    description,
    habits,
    danger,
    onToggle
}) {
    return (
        <section className="section">

            <div className="section-heading">

                <div>
                    <p className="section-number">
                        {number}
                    </p>

                    <h3>
                        {title}
                    </h3>
                </div>

                <p>
                    {description}
                </p>

            </div>

            <div className="habit-grid">

                {habits.map((habit) => (
                    <HabitCard
                        key={habit.key}
                        name={habit.name}
                        icon={habit.icon}
                        completed={habit.completed}
                        danger={danger}
                        onClick={() =>
                            onToggle(habit.key)
                        }
                    />
                ))}

            </div>

        </section>
    );
}

export default HabitSection;