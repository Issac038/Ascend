import { useEffect, useState } from "react";
import { Award, Lock } from "lucide-react";
import api from "../../services/api";
import { PageSkeleton } from "../ui/Primitives";

export default function Achievements() {
    const [data, setData] = useState(null);

    useEffect(() => {
        api.get("/achievements").then((res) => setData(res.data)).catch(() => {});
    }, []);

    if (!data) return <PageSkeleton />;

    const earned = data.achievements.filter((a) => a.earned);
    const locked = data.achievements.filter((a) => !a.earned);

    return (
        <div className="page-fade">
            <div className="page-head">
                <div>
                    <h1>Achievements</h1>
                    <p className="sub">Milestones of a person showing up. Quietly earned, never given.</p>
                </div>
                <div className="badge solid">{data.earnedCount} / {data.totalCount}</div>
            </div>

            <div className="progress-track" style={{ marginBottom: 30 }}>
                <div className="progress-fill" style={{ width: `${Math.round((data.earnedCount / data.totalCount) * 100)}%` }} />
            </div>

            {earned.length > 0 && (
                <div className="section">
                    <div className="section-title"><h2>Earned</h2></div>
                    <div className="grid cols-2">
                        {earned.map((a) => (
                            <div className="card achievement-card earned" key={a.code}>
                                <div className="ach-icon"><Award size={20} /></div>
                                <div className="ach-body">
                                    <h3>{a.name}</h3>
                                    <p className="ach-desc">{a.description}</p>
                                    <p className="ach-date">
                                        Earned {new Date(a.earnedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="section">
                <div className="section-title"><h2>Still ahead</h2></div>
                <div className="grid cols-2">
                    {locked.map((a) => (
                        <div className="card achievement-card locked" key={a.code}>
                            <div className="ach-icon"><Lock size={18} /></div>
                            <div className="ach-body">
                                <h3>{a.name}</h3>
                                <p className="ach-desc">{a.description}</p>
                                <p className="ach-how">{a.how}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
