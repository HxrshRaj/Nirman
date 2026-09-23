import { APP_NAME } from '../constants';

export function renderFooter(year) {
  return `(c) ${year} ${APP_NAME}`;
}
