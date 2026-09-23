import { formatTitle } from '../utils/format';

export function renderHeader(title) {
  return `== ${formatTitle(title)} ==`;
}
