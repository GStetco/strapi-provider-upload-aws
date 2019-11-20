/*eslint-disable*/
'use strict';
/**
 * Module dependencies
 */

/* eslint-disable import/no-unresolved */
/* eslint-disable no-unused-vars */
// Public node modules.
const _ = require('lodash');
const AWS = require('aws-sdk');
const sharp = require('sharp');

//HELPERS

const decodeBase64Image = (dataString) => {
	const matches = dataString.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
	if (matches.length !== 3) return new Error('Invalid input string');
	return {
		type: matches[1],
		data: Buffer.from(matches[2], 'base64')
	};
};

const resize = async (buffer, size, quality) =>
	sharp(buffer)
		.resize(size)
		.jpeg({ quality: parseInt(quality) })
		.toBuffer()
		.then((data) => decodeBase64Image(`data:image/jpeg;base64,${data.toString('base64')}`));

const resizeCircle = async (buffer, size, quality, circle) =>
	sharp(buffer)
		.resize(size)
		.composite([ { input: circle, blend: 'dest-in' } ])
		.png()
		.toBuffer()
		.then((data) => decodeBase64Image(`data:image/png;base64,${data.toString('base64')}`));

const SSimageUpload = (S3) => (file, size) =>
	new Promise(async (resolve, reject) => {
		const { mime, hash, path: filePath, buffer, ext } = file;
		const path = filePath ? `${filePath}/` : '';
		let extension = ext;
		let resizedBuffer = null;
		try {
			if (size.isRound) {
				extension = '.png';
				let circle = new Buffer(
					`<svg><circle cx="${size.width / 2}" cy="${size.width / 2}" r="${size.width / 2}" /></svg>`
				);
				resizedBuffer = await resizeCircle(buffer, size, size.quality, circle);
			} else {
				resizedBuffer = await resize(buffer, size, size.quality);
			}
		} catch (err) {
			console.error('SSimageUpload', err); // TypeError: failed to fetch
			return reject(err);
		}

		const fileName = (file.related && file.related.length > 0 && file.related[0].refId) || hash;
		S3.upload(
			{
				Key: `${path}${size.path}/${fileName}${extension}`,
				Body: resizedBuffer.data,
				ACL: 'public-read',
				ContentType: mime
			},
			(err, data) => {
				if (err) return reject(err);
				return resolve(data.Location);
			}
		);
	});

const S3upload = (S3) => (file, size) =>
	new Promise(async (resolve, reject) => {
		const { mime, hash, path: filePath, buffer, ext } = file;
		const path = filePath ? `${filePath}/` : '';

		S3.upload(
			{
				Key: `${path}${file.hash}${file.ext}`,
				Body: new Buffer(file.buffer, 'binary'),
				ACL: 'public-read',
				ContentType: file.mime
			},
			(err, data) => {
				if (err) return reject(err);

				resolve(data.Location);
			}
		);
	});

const S3delete = (S3) => (file) =>
	new Promise((resolve, reject) => {
		const path = file.path ? `${file.path}/` : '';
		strapi.log.info('S3delete', `${path}${file.hash}_thumb${file.ext}`);
		if (thumb) {
			S3.deleteObject(
				{
					Key: `${path}${file.hash}_thumb${file.ext}`
				},
				(err, data) => {
					if (err) strapi.log.error('S3delete.THUMB.err', err);
				}
			);
		}

		S3.deleteObject(
			{
				Key: `${path}${file.hash}${file.ext}`
			},
			(err, data) => {
				if (err) {
					return reject(err);
				}
				resolve();
			}
		);
	});

const getFileExtension = function(ext) {
	let _videoExtensions = [ 'webm', 'mp4', 'mpg', 'mp2', 'mpeg', 'mpe', 'mpv', 'ogg' ];
	let _audioExtensions = [ 'wav', 'mp3', 'm4a', 'aac', 'ac3', 'flac', 'ape' ];
	let _imageExtensions = [ 'jpg', 'jpeg', 'png', 'gif', 'svg' ];

	// check if upload is a video //
	let _normalizedExt = ext.toLowerCase();
	for (var i = 0; i < _imageExtensions.length; i++) {
		if (_normalizedExt.indexOf(_imageExtensions[i].toLowerCase()) != -1) {
			return 'image';
		}
	}
	for (var i = 0; i < _videoExtensions.length; i++) {
		if (_normalizedExt.indexOf(_videoExtensions[i].toLowerCase()) != -1) {
			return 'video';
		}
	}
	for (var i = 0; i < _audioExtensions.length; i++) {
		if (_normalizedExt.indexOf(_audioExtensions[i].toLowerCase()) != -1) {
			return 'audio';
		}
	}

	return 'none';
};
module.exports = {
	provider: 'aws-s3-custom-size',
	name: 'Amazon Web Service S3 Custom Size',
	auth: {
		public: {
			label: 'Access API Token',
			type: 'text'
		},
		private: {
			label: 'Secret Access Token',
			type: 'text'
		},
		region: {
			label: 'Region',
			type: 'enum',
			values: [
				'us-east-1',
				'us-east-2',
				'us-west-1',
				'us-west-2',
				'ca-central-1',
				'ap-south-1',
				'ap-northeast-1',
				'ap-northeast-2',
				'ap-northeast-3',
				'ap-southeast-1',
				'ap-southeast-2',
				'cn-north-1',
				'cn-northwest-1',
				'eu-central-1',
				'eu-north-1',
				'eu-west-1',
				'eu-west-2',
				'eu-west-3',
				'sa-east-1'
			]
		},
		bucket: {
			label: 'Bucket',
			type: 'text'
		},
		width: {
			label: 'Width',
			type: 'number'
		},
		imageBucket: {
			label: 'Image Bucket',
			type: 'text'
		},
		imageSizes: {
			label: 'Sizes [{w: xx, h:xx, quality: 100, path: nn}]',
			type: 'text'
		},
		audioBucket: {
			label: 'Audio Bucket',
			type: 'text'
		},
		videoBucket: {
			label: 'Video Bucket',
			type: 'text'
		}
	},
	init: (config) => {
		// configure AWS S3 bucket connection
		AWS.config.update({
			accessKeyId: config.public,
			secretAccessKey: config.private,
			region: config.region
		});

		return {
			upload: (file) => {
				return new Promise((resolve, reject) => {
					let fileType = getFileExtension(file.ext);
					var path = '';

					if (fileType === 'image') {
						const S3 = new AWS.S3({ apiVersion: '2006-03-01', params: { Bucket: config.imageBucket } });
						const sizes = JSON.parse(config.imageSizes);
						const l = sizes.length;
						for (let i = 0; i < l; i++) {
							SSimageUpload(S3)(file, sizes[i])
								.then((url) => {
									if (i == l - 1) {
										file.url = url;
										resolve();
									}
								})
								.catch((err) => reject(err));
						}
					} else if (fileType === 'video') {
						const S3 = new AWS.S3({ apiVersion: '2006-03-01', params: { Bucket: config.videoBucket } });
						S3upload(S3)(file)
							.then((url) => {
								file.url = url;
								resolve();
							})
							.catch((err) => reject(err));
					} else if (fileType === 'audio') {
						const S3 = new AWS.S3({ apiVersion: '2006-03-01', params: { Bucket: config.audioBucket } });
						S3upload(S3)(file)
							.then((url) => {
								file.url = url;
								resolve();
							})
							.catch((err) => reject(err));
					} else {
						return reject('Filetype ' + file.ext + ' not allowed.');
					}
				});
			},
			delete: (file) => {
				// delete file on S3 bucket
				return S3delete(S3)(file, file.ext === '.jpg');
			}
		};
	}
};
