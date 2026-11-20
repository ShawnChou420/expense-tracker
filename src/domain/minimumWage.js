/**
 * 澳洲全國最低工資（National Minimum Wage）集中設定。
 * 只用於訪客首頁「快速試算」的預設時薪；不是薪資合規判定，也不套用到正式薪資計算。
 * 每年 7/1 調整：在 NATIONAL_MINIMUM_WAGES 加一筆即可，不要在元件中寫死數字。
 *
 * 2026-07-01 的數字依規格提供，需以 Fair Work 公告確認：
 * https://www.fairwork.gov.au/pay-and-wages/minimum-wages
 */

/**
 * @typedef {object} MinimumWage
 * @property {string} effectiveDate 生效日 YYYY-MM-DD
 * @property {number} hourlyCents 時薪（cents）
 * @property {number} weeklyCents 官方公告週薪（cents；與時薪 × 38 可能有進位差異）
 * @property {string} employmentBasis 適用對象
 * @property {string} sourceUrl
 */

/** @type {MinimumWage[]} 依生效日由舊到新 */
export const NATIONAL_MINIMUM_WAGES = [
  {
    effectiveDate: '2026-07-01',
    hourlyCents: 2644,
    weeklyCents: 100490,
    employmentBasis: '符合條件、未受 Award 或企業協議涵蓋的成年員工',
    sourceUrl: 'https://www.fairwork.gov.au/pay-and-wages/minimum-wages',
  },
]

/**
 * 指定日期當時適用的最低工資；早於第一筆時回傳最早那一筆。
 * @param {string} date YYYY-MM-DD
 * @returns {MinimumWage}
 */
export function getMinimumWage(date) {
  let current = NATIONAL_MINIMUM_WAGES[0]
  for (const wage of NATIONAL_MINIMUM_WAGES) if (wage.effectiveDate <= date) current = wage
  return current
}
