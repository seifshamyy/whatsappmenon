import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
    children: ReactNode;
}

interface State {
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
    state: State = { error: null, errorInfo: null };

    private onError = (event: ErrorEvent) => {
        // Log only — don't show in UI, global errors include WebSocket noise
        // from Supabase/extensions that shouldn't replace the app UI.
        console.error('[GlobalError]', event.error ?? event.message);
    };

    private onUnhandledRejection = (event: PromiseRejectionEvent) => {
        console.error('[UnhandledRejection]', event.reason);
    };

    componentDidMount() {
        window.addEventListener('error', this.onError);
        window.addEventListener('unhandledrejection', this.onUnhandledRejection);
    }

    componentWillUnmount() {
        window.removeEventListener('error', this.onError);
        window.removeEventListener('unhandledrejection', this.onUnhandledRejection);
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        this.setState({ error, errorInfo });
        console.error('[ErrorBoundary] Caught crash:', error, errorInfo);
    }

    render() {
        const { error, errorInfo } = this.state;
        if (!error) return this.props.children;

        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
                <div className="w-full max-w-lg bg-white rounded-2xl border border-red-200 shadow-lg overflow-hidden">
                    <div className="bg-red-500 px-5 py-4">
                        <h1 className="text-white font-bold text-lg">Something crashed</h1>
                        <p className="text-red-100 text-sm mt-0.5">Copy this and send it over so we can fix it</p>
                    </div>

                    <div className="p-5 space-y-4">
                        <div>
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Error</p>
                            <p className="text-sm font-mono text-red-600 bg-red-50 rounded-lg px-3 py-2 break-words">
                                {error.toString()}
                            </p>
                        </div>

                        {errorInfo && (
                            <div>
                                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Stack</p>
                                <pre className="text-[11px] font-mono text-slate-600 bg-slate-50 rounded-lg px-3 py-2 overflow-auto max-h-48 whitespace-pre-wrap break-words">
                                    {errorInfo.componentStack}
                                </pre>
                            </div>
                        )}

                        <button
                            onClick={() => window.location.reload()}
                            className="w-full py-2.5 rounded-xl text-white font-semibold text-sm"
                            style={{ backgroundColor: 'var(--color-primary, #6366f1)' }}
                        >
                            Reload app
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}
