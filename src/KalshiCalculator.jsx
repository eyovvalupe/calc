import React, { useEffect, useMemo, useState } from "react";
import { defaultMarketOptions } from './types.js';
import { calculateMarketMetrics } from './utils.js';

// Kalshi Market Calculator Component
export default function KalshiCalculator() {
  const [marketOptions, setMarketOptions] = useState(defaultMarketOptions);
  const [deposits, setDeposits] = useState({});

  // Initialize deposits
  useEffect(() => {
    const initialDeposits = {};
    if (Array.isArray(marketOptions)) {
      marketOptions.forEach(market => {
        if (market && market.id) {
          initialDeposits[market.id] = 0;
        }
      });
    }
    setDeposits(initialDeposits);
  }, []);

  // Calculate metrics for each market option
  const marketMetrics = useMemo(() => {
    try {
      return calculateMarketMetrics(marketOptions, deposits);
    } catch (error) {
      console.error('Error calculating market metrics:', error);
      return [];
    }
  }, [marketOptions, deposits]);

  const handleDepositChange = (marketId, value) => {
    const numericValue = parseFloat(value) || 0;
    setDeposits(prev => ({
      ...prev,
      [marketId]: numericValue,
    }));
  };

  const handleYesPriceChange = (marketId, value) => {
    const numericValue = parseFloat(value) || 0;
    setMarketOptions(prev => prev.map(market => 
      market.id === marketId ? { ...market, yesPrice: numericValue } : market
    ));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-medium">Hedge Calculator for Kalshi Climate Trades</h4>
      </div>

      {/* Market Table */}
      <div className="overflow-x-auto">
        <table className="w-full bg-white rounded-lg shadow-sm border">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Range</th>
              <th className="px-4 py-3 text-center text-sm font-medium text-gray-700">Yes Price ($)</th>
              <th className="px-4 py-3 text-center text-sm font-medium text-gray-700">Deposit ($)</th>
              <th className="px-4 py-3 text-center text-sm font-medium text-gray-700">Payout ($)</th>
              <th className="px-4 py-3 text-center text-sm font-medium text-gray-700">Profit/Loss ($)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {marketMetrics.map((market, index) => (
              <tr key={market.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm font-medium text-gray-900">
                  {market.range}
                </td>
                <td className="px-4 py-3 text-center">
                  <input
                    type="number"
                    value={market.yesPrice}
                    onChange={(e) => handleYesPriceChange(market.id, e.target.value)}
                    className="w-20 px-2 py-1 border border-gray-300 rounded text-sm text-center focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    min="0"
                    max="1"
                    step="0.01"
                    placeholder="0.00"
                  />
                </td>
                <td className="px-4 py-3 text-center">
                  <input
                    type="number"
                    value={market.deposit}
                    onChange={(e) => handleDepositChange(market.id, e.target.value)}
                    className="w-20 px-2 py-1 border border-gray-300 rounded text-sm text-center focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                  />
                </td>
                <td className="px-4 py-3 text-sm text-green-700 text-center font-semibold">
                  ${market.minPayout}
                </td>
                <td className={`px-4 py-3 text-sm text-center font-semibold ${
                  parseFloat(market.profitLoss) >= 0 ? 'text-green-700' : 'text-red-700'
                }`}>
                  ${market.profitLoss}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Summary */}
      <div className="bg-gray-50 p-4 rounded-lg">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div className="text-center">
            <div className="text-gray-600">Total Investment</div>
            <div className="font-semibold text-lg">
              ${Object.values(deposits).reduce((sum, deposit) => sum + deposit, 0).toFixed(2)}
            </div>
          </div>
          <div className="text-center">
            <div className="text-gray-600">Min Profit/Loss</div>
            <div className={`font-semibold text-lg ${
              (() => {
                const totalInvestment = Object.values(deposits).reduce((sum, deposit) => sum + deposit, 0);
                const activeMarkets = marketMetrics.filter(m => m.deposit > 0);
                if (activeMarkets.length === 0) return 'text-gray-700';
                const minPayout = Math.min(...activeMarkets.map(m => parseInt(m.minPayout)));
                const minProfit = minPayout - totalInvestment;
                return minProfit >= 0 ? 'text-green-700' : 'text-red-700';
              })()
            }`}>
              ${(() => {
                const totalInvestment = Object.values(deposits).reduce((sum, deposit) => sum + deposit, 0);
                const activeMarkets = marketMetrics.filter(m => m.deposit > 0);
                if (activeMarkets.length === 0) return '0.00';
                const minPayout = Math.min(...activeMarkets.map(m => parseInt(m.minPayout)));
                const minProfit = minPayout - totalInvestment;
                return minProfit.toFixed(2);
              })()}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
