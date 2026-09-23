import { renderApp } from './app';
import { APP_NAME } from './constants';

renderApp().then((output) => {
  console.log(`[${APP_NAME}]`);
  console.log(output);
});
