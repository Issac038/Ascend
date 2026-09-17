function Register({
    name,
    email,
    password,
    setName,
    setEmail,
    setPassword,
    registerError,
    loading,
    onRegister,
    onBackToLogin
}) {
    return (
        <div className="login-page">
            <div className="login-glow"></div>

            <div className="login-container">

                <div className="brand-mark">
                    A
                </div>

                <p className="eyebrow">
                    YOUR LIFE. YOUR RULES.
                </p>

                <h1>ASCEND</h1>

                <p className="login-subtitle">
                    Start becoming who you said you'd become.
                </p>

                <form onSubmit={onRegister}>

                    <div className="input-group">
                        <label>Name</label>

                        <input
                            type="text"
                            placeholder="Your name"
                            value={name}
                            onChange={(e) =>
                                setName(e.target.value)
                            }
                            required
                        />
                    </div>

                    <div className="input-group">
                        <label>Email</label>

                        <input
                            type="email"
                            placeholder="you@example.com"
                            value={email}
                            onChange={(e) =>
                                setEmail(e.target.value)
                            }
                            required
                        />
                    </div>

                    <div className="input-group">
                        <label>Password</label>

                        <input
                            type="password"
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) =>
                                setPassword(e.target.value)
                            }
                            required
                        />
                    </div>

                    {registerError && (
                        <p className="login-error">
                            {registerError}
                        </p>
                    )}

                    <button
                        type="submit"
                        className="login-button"
                        disabled={loading}
                    >
                        {loading
                            ? "CREATING..."
                            : "CREATE ACCOUNT"}

                        <span>→</span>
                    </button>

                </form>

                <div className="auth-switch">
                    <button
                        type="button"
                        className="login-button auth-switch-button"
                        onClick={onBackToLogin}
                    >
                    <span>←</span>
                    ALREADY HAVE AN ACCOUNT? SIGN IN
                    </button>
                </div>

                <p className="login-footer">
                    Discipline is built one day at a time.
                </p>

            </div>
        </div>
    );
}

export default Register;