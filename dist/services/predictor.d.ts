export interface PredictionResult {
    currentTraffic: number;
    predicted30d: number;
    predicted60d: number;
    predicted90d: number;
    growthPotential: number;
    recommendations: string[];
}
export declare class PredictiveAnalyticsService {
    /**
     * Forecasts traffic based on current metrics and identifies potential uplift
     * if specific SEO actions are taken.
     */
    static forecast(siteId: string): Promise<PredictionResult>;
    /**
     * Predicts keyword position movement based on historical volatility.
     */
    static forecastKeyword(keyword: string, currentPosition: number): Promise<{
        keyword: string;
        currentPosition: number;
        projectedPosition: number;
        estimatedDays: number;
        difficultyScore: number;
    }>;
}
//# sourceMappingURL=predictor.d.ts.map