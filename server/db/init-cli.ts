import { getDb, DB_PATH } from './index.ts';

getDb()
  .then(() => {
    console.log('DB ready:', DB_PATH);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
