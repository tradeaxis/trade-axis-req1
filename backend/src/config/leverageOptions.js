const DEFAULT_LEVERAGE_OPTIONS = [1, 2, 5, 10, 20, 25, 30, 40, 50, 100, 200, 300, 500, 1000];

const normalizeLeverageOptions = (values = []) => (
  [...new Set(
    values
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0),
  )].sort((a, b) => a - b)
);

const parseEnvLeverageOptions = () => {
  const raw = String(process.env.LEVERAGE_OPTIONS || '').trim();
  if (!raw) return null;

  const parsed = normalizeLeverageOptions(raw.split(','));
  return parsed.length > 0 ? parsed : null;
};

const getAllowedLeverageOptions = () => {
  const envOptions = parseEnvLeverageOptions();
  return envOptions || DEFAULT_LEVERAGE_OPTIONS;
};

const isAllowedLeverage = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return false;
  return getAllowedLeverageOptions().includes(numeric);
};

module.exports = {
  DEFAULT_LEVERAGE_OPTIONS,
  getAllowedLeverageOptions,
  isAllowedLeverage,
  normalizeLeverageOptions,
};
