function Login({
    email,
    password,
    setEmail,
    setPassword,
    loginError,
    loading,
    onLogin,
    onRegister
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
                    Become the person you said you'd become.
                </p>

                <form onSubmit={onLogin}>

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

                    {loginError && (
                        <p className="login-error">
                            {loginError}
                        </p>
                    )}

                    <button
                        type="submit"
                        className="login-button"
                        disabled={loading}
                    >
                        {loading
                            ? "ENTERING..."
                            : "ENTER ASCEND"}

                        <span>→</span>
                    </button>

                </form>

                <div className="auth-switch">
                    <button
                        type="button"
                        className="login-button auth-switch-button"
                        onClick={onRegister}
                    >
                    REGISTER
                    <span>→</span>
                    </button>
                </div>

                <p className="login-footer">
                    Discipline is built one day at a time.
                </p>

            </div>
        </div>
    );
}

export default Login;