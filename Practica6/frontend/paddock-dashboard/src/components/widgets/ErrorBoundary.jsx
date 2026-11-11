import React from 'react';

export default class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, errorMessage: '' };
    }

    static getDerivedStateFromError(error) {
        return {
            hasError: true,
            errorMessage: error?.message || 'Error inesperado en el componente aislado.',
        };
    }

    componentDidCatch(error, errorInfo) {
        console.warn(
            `[Bulkhead ErrorBoundary: ${this.props.serviceName || 'Widget'}] Fallo aislado contenido:`,
            error,
            errorInfo
        );
    }

    handleReset = () => {
        this.setState({ hasError: false, errorMessage: '' });
        if (typeof this.props.onRetry === 'function') {
            this.props.onRetry();
        }
    };

    render() {
        if (this.state.hasError) {
            return (
                <div className="bg-neutral-900 border border-amber-500/40 rounded-lg p-4 font-mono text-xs flex flex-col justify-between gap-3 shadow-lg">
                    <div className="flex justify-between items-center border-b border-neutral-800 pb-2">
                        <span className="text-amber-400 font-bold uppercase">
                            AISLAMIENTO DE FALLO • {this.props.serviceName || 'MICROSERVICIO UI'}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/30 text-[10px]">
                            CONTENIDO
                        </span>
                    </div>
                    <p className="text-neutral-400 text-[11px] leading-relaxed">
                        Este módulo experimentó una excepción ({this.state.errorMessage}), pero el patrón{' '}
                        <strong className="text-neutral-200">Error Boundary / Bulkhead</strong> evitó que el resto de
                        la PWA se detuviera.
                    </p>
                    <div className="flex justify-end">
                        <button
                            onClick={this.handleReset}
                            className="px-3 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[10px] font-bold cursor-pointer"
                        >
                            REINTENTAR MÓDULO
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
