export declare const analyzeUrl: (url: string, strategy: "mobile" | "desktop") => Promise<{
    strategy: "mobile" | "desktop";
    url: string;
    fetchTime: string | null | undefined;
    scores: {
        performance: number | null;
        accessibility: number | null;
        bestPractices: number | null;
        seo: number | null;
    };
    coreWebVitals: {
        lab: {
            lcp: {
                value: any;
                displayValue: any;
                rating: string;
            } | null;
            fcp: {
                value: any;
                displayValue: any;
                rating: string;
            } | null;
            cls: {
                value: any;
                displayValue: any;
                rating: string;
            } | null;
            tbt: {
                value: any;
                displayValue: any;
                rating: string;
            } | null;
            speedIndex: {
                value: any;
                displayValue: any;
                rating: string;
            } | null;
            ttfb: {
                value: any;
                displayValue: any;
                rating: string;
            } | null;
            inp: {
                value: any;
                displayValue: any;
                rating: string;
            } | null;
        };
        field: {
            lcp: {
                p75: any;
                category: any;
                distributions: any;
            } | null;
            fid: {
                p75: any;
                category: any;
                distributions: any;
            } | null;
            inp: {
                p75: any;
                category: any;
                distributions: any;
            } | null;
            cls: {
                p75: any;
                category: any;
                distributions: any;
            } | null;
            fcp: {
                p75: any;
                category: any;
                distributions: any;
            } | null;
            ttfb: {
                p75: any;
                category: any;
                distributions: any;
            } | null;
        } | null;
        originField: {
            lcp: {
                p75: any;
                category: any;
                distributions: any;
            } | null;
            fid: {
                p75: any;
                category: any;
                distributions: any;
            } | null;
            inp: {
                p75: any;
                category: any;
                distributions: any;
            } | null;
            cls: {
                p75: any;
                category: any;
                distributions: any;
            } | null;
            fcp: {
                p75: any;
                category: any;
                distributions: any;
            } | null;
            ttfb: {
                p75: any;
                category: any;
                distributions: any;
            } | null;
        } | null;
    };
    opportunities: any[];
    diagnostics: {
        domSize: {
            value: any;
            details: any;
        };
        mainThread: any;
        networkRequests: any;
        networkRtt: any;
        thirdParty: any;
        longTasks: any;
        resourceSummary: any;
    };
    audits: {
        seo: ({
            id: any;
            title: any;
            description: any;
            score: any;
            displayValue: any;
            passed: boolean;
        } | null)[];
        accessibility: ({
            id: any;
            title: any;
            description: any;
            score: any;
            displayValue: any;
            passed: boolean;
        } | null)[];
        bestPractices: ({
            id: any;
            title: any;
            description: any;
            score: any;
            displayValue: any;
            passed: boolean;
        } | null)[];
    };
    screenshots: {
        final: any;
        filmstrip: any;
    };
} | {
    strategy: "mobile" | "desktop";
    url: string;
    fetchTime: string;
    scores: {
        performance: number;
        accessibility: number;
        bestPractices: number;
        seo: number;
    };
    coreWebVitals: {
        lab: {
            lcp: {
                value: number;
                displayValue: string;
                rating: string;
            };
            fcp: {
                value: number;
                displayValue: string;
                rating: string;
            };
            cls: {
                value: number;
                displayValue: string;
                rating: string;
            };
            tbt: {
                value: number;
                displayValue: string;
            };
            speedIndex: {
                value: number;
                displayValue: string;
            };
            ttfb: {
                value: number;
                displayValue: string;
                rating: string;
            };
        };
        field: null;
        originField: null;
    };
    opportunities: {
        id: string;
        title: string;
        description: string;
        wastedBytes: number;
        wastedMs: number;
        items: {
            url: string;
            totalBytes: number;
            wastedBytes: number;
        }[];
    }[];
    diagnostics: {
        domSize: {
            value: number;
            details: never[];
        };
        mainThread: never[];
        networkRequests: never[];
        networkRtt: number;
        thirdParty: never[];
        longTasks: never[];
        resourceSummary: never[];
    };
    audits: {
        seo: never[];
        accessibility: never[];
        bestPractices: never[];
    };
    screenshots: {
        final: null;
        filmstrip: never[];
    };
}>;
export declare const runFullAnalysis: (url: string) => Promise<{
    url: string;
    timestamp: string;
    mobile: {
        strategy: "mobile" | "desktop";
        url: string;
        fetchTime: string | null | undefined;
        scores: {
            performance: number | null;
            accessibility: number | null;
            bestPractices: number | null;
            seo: number | null;
        };
        coreWebVitals: {
            lab: {
                lcp: {
                    value: any;
                    displayValue: any;
                    rating: string;
                } | null;
                fcp: {
                    value: any;
                    displayValue: any;
                    rating: string;
                } | null;
                cls: {
                    value: any;
                    displayValue: any;
                    rating: string;
                } | null;
                tbt: {
                    value: any;
                    displayValue: any;
                    rating: string;
                } | null;
                speedIndex: {
                    value: any;
                    displayValue: any;
                    rating: string;
                } | null;
                ttfb: {
                    value: any;
                    displayValue: any;
                    rating: string;
                } | null;
                inp: {
                    value: any;
                    displayValue: any;
                    rating: string;
                } | null;
            };
            field: {
                lcp: {
                    p75: any;
                    category: any;
                    distributions: any;
                } | null;
                fid: {
                    p75: any;
                    category: any;
                    distributions: any;
                } | null;
                inp: {
                    p75: any;
                    category: any;
                    distributions: any;
                } | null;
                cls: {
                    p75: any;
                    category: any;
                    distributions: any;
                } | null;
                fcp: {
                    p75: any;
                    category: any;
                    distributions: any;
                } | null;
                ttfb: {
                    p75: any;
                    category: any;
                    distributions: any;
                } | null;
            } | null;
            originField: {
                lcp: {
                    p75: any;
                    category: any;
                    distributions: any;
                } | null;
                fid: {
                    p75: any;
                    category: any;
                    distributions: any;
                } | null;
                inp: {
                    p75: any;
                    category: any;
                    distributions: any;
                } | null;
                cls: {
                    p75: any;
                    category: any;
                    distributions: any;
                } | null;
                fcp: {
                    p75: any;
                    category: any;
                    distributions: any;
                } | null;
                ttfb: {
                    p75: any;
                    category: any;
                    distributions: any;
                } | null;
            } | null;
        };
        opportunities: any[];
        diagnostics: {
            domSize: {
                value: any;
                details: any;
            };
            mainThread: any;
            networkRequests: any;
            networkRtt: any;
            thirdParty: any;
            longTasks: any;
            resourceSummary: any;
        };
        audits: {
            seo: ({
                id: any;
                title: any;
                description: any;
                score: any;
                displayValue: any;
                passed: boolean;
            } | null)[];
            accessibility: ({
                id: any;
                title: any;
                description: any;
                score: any;
                displayValue: any;
                passed: boolean;
            } | null)[];
            bestPractices: ({
                id: any;
                title: any;
                description: any;
                score: any;
                displayValue: any;
                passed: boolean;
            } | null)[];
        };
        screenshots: {
            final: any;
            filmstrip: any;
        };
    } | {
        strategy: "mobile" | "desktop";
        url: string;
        fetchTime: string;
        scores: {
            performance: number;
            accessibility: number;
            bestPractices: number;
            seo: number;
        };
        coreWebVitals: {
            lab: {
                lcp: {
                    value: number;
                    displayValue: string;
                    rating: string;
                };
                fcp: {
                    value: number;
                    displayValue: string;
                    rating: string;
                };
                cls: {
                    value: number;
                    displayValue: string;
                    rating: string;
                };
                tbt: {
                    value: number;
                    displayValue: string;
                };
                speedIndex: {
                    value: number;
                    displayValue: string;
                };
                ttfb: {
                    value: number;
                    displayValue: string;
                    rating: string;
                };
            };
            field: null;
            originField: null;
        };
        opportunities: {
            id: string;
            title: string;
            description: string;
            wastedBytes: number;
            wastedMs: number;
            items: {
                url: string;
                totalBytes: number;
                wastedBytes: number;
            }[];
        }[];
        diagnostics: {
            domSize: {
                value: number;
                details: never[];
            };
            mainThread: never[];
            networkRequests: never[];
            networkRtt: number;
            thirdParty: never[];
            longTasks: never[];
            resourceSummary: never[];
        };
        audits: {
            seo: never[];
            accessibility: never[];
            bestPractices: never[];
        };
        screenshots: {
            final: null;
            filmstrip: never[];
        };
    };
    desktop: {
        strategy: "mobile" | "desktop";
        url: string;
        fetchTime: string | null | undefined;
        scores: {
            performance: number | null;
            accessibility: number | null;
            bestPractices: number | null;
            seo: number | null;
        };
        coreWebVitals: {
            lab: {
                lcp: {
                    value: any;
                    displayValue: any;
                    rating: string;
                } | null;
                fcp: {
                    value: any;
                    displayValue: any;
                    rating: string;
                } | null;
                cls: {
                    value: any;
                    displayValue: any;
                    rating: string;
                } | null;
                tbt: {
                    value: any;
                    displayValue: any;
                    rating: string;
                } | null;
                speedIndex: {
                    value: any;
                    displayValue: any;
                    rating: string;
                } | null;
                ttfb: {
                    value: any;
                    displayValue: any;
                    rating: string;
                } | null;
                inp: {
                    value: any;
                    displayValue: any;
                    rating: string;
                } | null;
            };
            field: {
                lcp: {
                    p75: any;
                    category: any;
                    distributions: any;
                } | null;
                fid: {
                    p75: any;
                    category: any;
                    distributions: any;
                } | null;
                inp: {
                    p75: any;
                    category: any;
                    distributions: any;
                } | null;
                cls: {
                    p75: any;
                    category: any;
                    distributions: any;
                } | null;
                fcp: {
                    p75: any;
                    category: any;
                    distributions: any;
                } | null;
                ttfb: {
                    p75: any;
                    category: any;
                    distributions: any;
                } | null;
            } | null;
            originField: {
                lcp: {
                    p75: any;
                    category: any;
                    distributions: any;
                } | null;
                fid: {
                    p75: any;
                    category: any;
                    distributions: any;
                } | null;
                inp: {
                    p75: any;
                    category: any;
                    distributions: any;
                } | null;
                cls: {
                    p75: any;
                    category: any;
                    distributions: any;
                } | null;
                fcp: {
                    p75: any;
                    category: any;
                    distributions: any;
                } | null;
                ttfb: {
                    p75: any;
                    category: any;
                    distributions: any;
                } | null;
            } | null;
        };
        opportunities: any[];
        diagnostics: {
            domSize: {
                value: any;
                details: any;
            };
            mainThread: any;
            networkRequests: any;
            networkRtt: any;
            thirdParty: any;
            longTasks: any;
            resourceSummary: any;
        };
        audits: {
            seo: ({
                id: any;
                title: any;
                description: any;
                score: any;
                displayValue: any;
                passed: boolean;
            } | null)[];
            accessibility: ({
                id: any;
                title: any;
                description: any;
                score: any;
                displayValue: any;
                passed: boolean;
            } | null)[];
            bestPractices: ({
                id: any;
                title: any;
                description: any;
                score: any;
                displayValue: any;
                passed: boolean;
            } | null)[];
        };
        screenshots: {
            final: any;
            filmstrip: any;
        };
    } | {
        strategy: "mobile" | "desktop";
        url: string;
        fetchTime: string;
        scores: {
            performance: number;
            accessibility: number;
            bestPractices: number;
            seo: number;
        };
        coreWebVitals: {
            lab: {
                lcp: {
                    value: number;
                    displayValue: string;
                    rating: string;
                };
                fcp: {
                    value: number;
                    displayValue: string;
                    rating: string;
                };
                cls: {
                    value: number;
                    displayValue: string;
                    rating: string;
                };
                tbt: {
                    value: number;
                    displayValue: string;
                };
                speedIndex: {
                    value: number;
                    displayValue: string;
                };
                ttfb: {
                    value: number;
                    displayValue: string;
                    rating: string;
                };
            };
            field: null;
            originField: null;
        };
        opportunities: {
            id: string;
            title: string;
            description: string;
            wastedBytes: number;
            wastedMs: number;
            items: {
                url: string;
                totalBytes: number;
                wastedBytes: number;
            }[];
        }[];
        diagnostics: {
            domSize: {
                value: number;
                details: never[];
            };
            mainThread: never[];
            networkRequests: never[];
            networkRtt: number;
            thirdParty: never[];
            longTasks: never[];
            resourceSummary: never[];
        };
        audits: {
            seo: never[];
            accessibility: never[];
            bestPractices: never[];
        };
        screenshots: {
            final: null;
            filmstrip: never[];
        };
    };
}>;
//# sourceMappingURL=pagespeed.d.ts.map