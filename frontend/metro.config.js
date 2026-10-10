// 서버와 공유하는 계약 파일(server/src/shared)을 번들에 포함하기 위해 감시 폴더를 추가한다.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, "../server/src/shared")];

module.exports = config;
