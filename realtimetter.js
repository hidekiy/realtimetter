/*
 * Copyright (c) 2012 ptyapp.com. All rights reserved.
 */

/*jslint browser: true, devel: true*/
/*global chrome, jQuery, OAuth*/

(function () {
	'use strict';

	var $ = jQuery,
		getMessage = chrome.i18n.getMessage,
		originalTitle = document.title,
		unreadCount = 0,
		pageTitle,
		config = {
			consumerKey: 'lLSbVLSmskQr1r8XU9Plw',
			consumerSecret: 'arFWaKGg3PkCwP2RuxWe4OFEdPBBKzNRme6BABaa90I'
		},
		jqxhrStream,
		ajaxErrorNotificationTimer;

	$.ajaxSetup({
		beforeSend: function (jqxhr, settings) {
			var message;
			// console.log('beforeSend', jqxhr, settings);

			if (settings.url.match(/^https:\/\/[a-z]+\.twitter\.com\//)) {
				message = {
					method: settings.type,
					action: settings.url
				};

				OAuth.setParameter(message, 'oauth_version', '1.0a');
				OAuth.setParameters(message, settings.data);

				if (!localStorage.getItem('oauth_token')) {
					OAuth.setParameter(
						message,
						'oauth_callback',
						['chrome-extension://', chrome.app.getDetails().id, '/index.html'].join('')
					);
				}

				OAuth.completeRequest(message, {
					consumerKey: config.consumerKey,
					consumerSecret: config.consumerSecret,
					token: localStorage.getItem('oauth_token'),
					tokenSecret: localStorage.getItem('oauth_token_secret')
				});
				// console.log('message', message);

				jqxhr.setRequestHeader(
					'Authorization',
					OAuth.getAuthorizationHeader('https://api.twitter.com', message.parameters)
				);
			}
		}
	});

	function updateTitle() {
		var title;

		if (pageTitle) {
			if (unreadCount > 0) {
				title = [
					['(', unreadCount, ') ', pageTitle].join(''),
					originalTitle
				].join(' - ');
			} else {
				title = [pageTitle, originalTitle].join(' - ');
			}
		} else {
			title = originalTitle;
		}

		if (document.title !== title) {
			console.log('updateTitle', title);
			document.title = title;
		}
	}

	function setPageTitle(t) {
		pageTitle = t;
		updateTitle();
	}

	function resetPageState() {
		if (jqxhrStream) {
			jqxhrStream.abort();
			jqxhrStream = null;
		}

		unreadCount = 0;
		setPageTitle(null);
		$('.selected').removeClass('selected');
		$('#result').empty();
	}

	function refreshWelcomeMessage() {
		if (!(localStorage.getItem('oauth_token') && localStorage.getItem('oauth_token_secret'))) {
			$('#welcome').show();
		}
	}

	function clearOAuthToken() {
		console.log('clearOAuthToken');
		localStorage.removeItem('oauth_token');
		localStorage.removeItem('oauth_token_secret');
	}

	$(document).ajaxError(function (event, jqxhr, settings, error) {
		var notification;

		console.log('ajaxError', event, jqxhr, settings, error);

		if (jqxhr.statusText === 'abort') {
			return;
		}

		if (jqxhr.status === 401) {
			clearOAuthToken();
			refreshWelcomeMessage();
		}

		new Notification('XHR Error', {
			icon: 'icon_128.png',
			body: JSON.stringify({
				type: settings.type,
				url: settings.url.replace('.com/', '.com/ '),
				status: jqxhr.status,
				statusText: jqxhr.statusText,
				date: String(new Date())
			}, null, 1)
		});

		ajaxErrorNotificationTimer = setTimeout(function () {
			notification.show();
		}, 1500);
	});

	function getResponseTextProcessor(cb) {
		var len = 0,
			buffer = '',
			bufferAppender = function (chunk) {
				var lines;

				buffer += chunk;
				lines = buffer.split('\n');
				buffer = lines.pop();

				cb(lines);
			};


		return function (xhr) {
			var chunk;

			if (xhr.status === 200) {
				chunk = xhr.responseText.slice(len);
				len = xhr.responseText.length;
				bufferAppender(chunk);
			}
		};
	}

	function embedEntities(text, entities) {
		var list = text.split('');

		function clearRange(a, b) {
			var l = list,
				i;

			for (i = a; i <= b; i += 1) {
				l[i] = '';
			}
		}

		['urls', 'media', 'user_mentions', 'hashtags'].forEach(function (type) {
			if (!entities[type]) {
				return;
			}

			entities[type].forEach(function (u) {
				var b = u.indices[0],
					e = u.indices[1];

				clearRange(b, e);

				if (['urls', 'media'].indexOf(type) !== -1) {
					list[b] = $('<span />').append($('<a />', {
						href: u.url,
						title: u.expanded_url + ' (opens new tab)',
						target: '_blank',
						text: u.display_url
					})).html() + ' ';
				} else if (type === 'user_mentions') {
					list[b] = $('<span />').append($('<a />', {
						href: 'https://twitter.com/' + u.screen_name,
						title: [u.name, ' @', u.screen_name, ' (opens new tab)'].join(''),
						target: '_blank',
						text: '@' + u.screen_name
					})).html() + ' ';
				} else if (type === 'hashtags') {
					list[b] = $('<span />').append($('<a />', {
						href: 'https://twitter.com/search/' + encodeURIComponent('#' + u.text),
						title: ['#', u.text, ' (opens new tab)'].join(''),
						target: '_blank',
						text: '#' + u.text
					})).html() + ' ';
				}
			});
		});

		return list.join('');
	}

	function parseCTime(str) {
		return new Date(str.replace(/\+0000/, 'UTC'));
	}

	function formatDate(date) {
		return [date.getYear() + 1900, date.getMonth() + 1, date.getDate()].join('-');
	}

	function formatTime(date) {
		return [date.getHours(), ('0' + date.getMinutes()).slice(-2), ('0' + date.getSeconds()).slice(-2)].join(':');
	}

	function parseTweet(tweet) {
		var $tweet = $('<div />', {
				id: 'tweet-' + tweet.id_str,
				'class': 'tweet'
			}),
			$profile,
			$info,
			replyTo;

		$('<a />', {href: 'https://twitter.com/' + tweet.user.screen_name, target: '_blank'}).append(
			$('<img />', {
				src: tweet.user.profile_image_url,
				css: {width: 48, height: 48, float: 'left'}
			})
		).appendTo($tweet);

		$profile = $('<p />', {'class': 'tweet-profile'})
			.append($('<a />', {
				href: 'https://twitter.com/' + tweet.user.screen_name,
				target: '_blank',
				css: {fontWeight: 'bold'},
				text: [tweet.user.name, ' @', tweet.user.screen_name].join('')
			})).appendTo($tweet);

		if (tweet.user.description && localStorage.getItem('showDescription')) {
			$profile
				.append(' ')
				.append($('<span />', {text: tweet.user.description}));
		}

		if (tweet.user.location) {
			$profile
				.append(' in ')
				.append($('<span />', {text: tweet.user.location}));
		}

		$('<p />', {
			'class': 'tweet-text',
			html: embedEntities(tweet.text, tweet.entities)
		}).appendTo($tweet);

		$info = $('<p />', {'class': 'tweet-info'})
			.append($('<a />', {
				href: ['https://twitter.com/', tweet.user.screen_name, '/status/', tweet.id_str].join(''),
				target: '_blank',
				text: 'at ' + formatTime(parseCTime(tweet.created_at))
			}))
			.append($('<span />', {html: ' via ' + tweet.source}).find('a').attr('target', '_blank').end())
			.appendTo($tweet);

		if (tweet.user.created_at) {
			$info.append(' ');
			$info.append($('<span />', {
				text: 'since ' + formatDate(parseCTime(tweet.user.created_at))
			}));
		}

		if (tweet.in_reply_to_status_id_str) {
			replyTo = tweet.in_reply_to_screen_name || tweet.to_user;

			$info.append(' ');
			$info.append($('<a />', {
				href: ['https://twitter.com/', replyTo, '/status/', tweet.in_reply_to_status_id_str].join(''),
				target: '_blank',
				text: 'in reply to @' + replyTo
			}));
		} else if (tweet.retweeted_status) {
			$info.append(' ');
			$info.append($('<a />', {
				href: ['https://twitter.com/', tweet.retweeted_status.user.screen_name, '/status/', tweet.retweeted_status.id_str].join(''),
				target: '_blank',
				text: 'retweeted from @' + tweet.retweeted_status.user.screen_name
			}));
		}

		if (!tweet.user.following) {
			$info.append(', ');
			$info.append($('<span />', {
				text: 'follow',
				'class': 'clickable',
				click: function () {
					if (confirm([
							'Follow?',
							'',
							[tweet.user.name, '@' + tweet.user.screen_name].join(' ')
						].join('\n'))) {

						$.post('https://api.twitter.com/1.1/friendships/create.json', {user_id: tweet.user.id_str}, function (data) {
							new Notification(getMessage('followComplete'), {
								icon: data.profile_image_url,
								body: '@' + data.screen_name
							});
						});
					}
				}
			}));
		}

		$info.append(', ');
		$info.append($('<span />', {
			text: 'retweet',
			'class': 'clickable',
			click: function () {
				if (confirm([
						'Retweet?',
						'',
						[tweet.user.name, '@' + tweet.user.screen_name, 'says:'].join(' '),
						'',
						'    ' + tweet.text
					].join('\n'))) {

					$.post(['https://api.twitter.com/1.1/statuses/retweet/', tweet.id_str, '.json'].join(''), function (data) {
						new Notification(getMessage('retweetComplete'), {
							icon: tweet.user.profile_image_url,
							body: data.text
						});
					});
				}
			}
		}));

		$info.append(', ');
		$info.append($('<span />', {
			text: 'favorite',
			'class': 'clickable',
			click: function () {
				$.post('https://api.twitter.com/1.1/favorites/create.json', {id: tweet.id_str}, function (data) {
					new Notification(getMessage('favoriteComplete'), {
						icon: data.user.profile_image_url,
						body: [
							'@' + data.user.screen_name,
							data.text
						].join('\n')
					});
				});
			}
		}));

		if (tweet.spamInfo) {
			$info.append(', ' + tweet.spamInfo);
		}

		if (document.webkitHidden) {
			$tweet.addClass('unread-tweet');
			unreadCount += 1;
			updateTitle();
		}

		return $tweet;
	}

	function isHashSpam(tweet) {
		return tweet.entities.hashtags.length > 3;
	}

	function isExcludedTweet(tweet) {
		if (localStorage.getItem('excludeRT') && tweet.text.match(/^RT /)) {
			return true;
		}

		if (isHashSpam(tweet)) {
			tweet.spamInfo = 'HASHSPAM';

			if (localStorage.getItem('excludeHashspam')) {
				return true;
			}
		}
	}

	$('#authApp, #welcomeAuthApp').val(getMessage('authApp'));

	$('#authApp, #welcomeAuthApp').click(function () {
		clearOAuthToken();

		$.post('https://api.twitter.com/oauth/request_token', function (data) {
			data = OAuth.getParameterMap(data);

			localStorage.setItem('oauth_token', data.oauth_token);
			localStorage.setItem('oauth_token_secret', data.oauth_token_secret);

			window.location = 'https://api.twitter.com/oauth/authorize?' + $.param({
				oauth_token: data.oauth_token
			});
		});
	});

	function refreshMenu() {
		var list = localStorage.getItem('trackMenuEditor').split('\n');

		$('#trackMenu').empty().append($.map(list, function (item) {
			if (item.match(/^\s*$/)) {
				return $('<br />')[0];
			}

			return $('<p />', {
				'class': 'clickable selectable',
				text: item
			})[0];
		}));
	}

	$('#trackMenuEditor').val(getMessage('defaultTrackMenu'));

	$('#trackMenuEditor').each(function () {
		var id = $(this).attr('id'),
			savedVal = localStorage.getItem(id);

		if (savedVal) {
			$(this).val(savedVal);
		}

		$(this).change(function () {
			localStorage.setItem(id, $(this).val());
			refreshMenu();
		}).change();
	});

	$('#showDescription, #excludeRT, #excludeHashspam').each(function () {
		var id = $(this).attr('id');

		$(this).parent().append($('<span />', {
			text: ' ' + getMessage(id)
		}));

		if (localStorage.getItem(id)) {
			$(this).attr('checked', 'checked');
		}

		$(this).change(function () {
			var c = $(this).is(':checked');

			localStorage.setItem(id, (c ? 't' : ''));
		}).change();
	});

	function trackKeyword(query) {
		$.get('https://api.twitter.com/1.1/search/tweets.json', {
			q: query,
			result_type: 'recent',
			include_entities: 'true'
		}, function (data) {
			console.log('search', data);

			data.statuses.forEach(function (tweet) {
				if (isExcludedTweet(tweet)) {
					return;
				}

				tweet.source = $('<span />', {html: tweet.source}).text();

				$('#result').append(parseTweet(tweet));
			});
		});

		(function () {
			var responseProcessor = getResponseTextProcessor(function (lines) {
					lines.reverse();

					lines.forEach(function (text) {
						var tweet;

						if (text.match(/^\s*$/)) {
							return;
						}

						tweet = JSON.parse(text);
						console.log('stream/filter.partial', tweet);

						if (isExcludedTweet(tweet)) {
							return;
						}

						$('#result').prepend(parseTweet(tweet));
					});
				}),
				jqxhr = $.ajax('https://stream.twitter.com/1.1/statuses/filter.json', {
					type: 'post',
					data: {
						track: query
					},
					xhrFields: {
						onprogress: function (e) {
							responseProcessor(e.target);
						}
					}
				});

			jqxhrStream = jqxhr;
		}());
	}

	$('#trackMenu').on('click', 'p', function () {
		var $this = $(this),
			query = $this.text();

		resetPageState();
		$this.addClass('selected');
		setPageTitle(query);

		trackKeyword(query);
	});

	$('#searchInput').focus(function () {
		if ($(this).val() === $(this).prop('defaultValue')) {
			$(this)
				.val('')
				.removeClass('defaultState');
		}
	}).blur(function () {
		if ($(this).val() === '') {
			$(this)
				.val($(this).prop('defaultValue'))
				.addClass('defaultState');
		}
	}).addClass('defaultState');

	$('#searchBox').submit(function () {
		var query = $(this).find('input').val();

		resetPageState();
		$(this).addClass('selected');
		setPageTitle(query);

		trackKeyword(query);

		return false;
	});

	$('#openTimeline').click(function () {
		var $this = $(this);

		resetPageState();
		$this.addClass('selected');
		setPageTitle('Home Timeline');

		$.get('https://api.twitter.com/1.1/statuses/home_timeline.json', {
			include_entities: 'true'
		}, function (data) {
			console.log('home_timeline', data);

			data.forEach(function (tweet) {
				$('#result').append(parseTweet(tweet));
			});
		});

		(function () {
			var responseProcessor = getResponseTextProcessor(function (lines) {
					lines.reverse();

					lines.forEach(function (text) {
						var tweet;

						if (text.match(/^\s*$/)) {
							return;
						}

						tweet = JSON.parse(text);
						console.log('userstream.partial', tweet);

						if (tweet['delete'] && tweet['delete'].status) {
							$('#tweet-' + tweet['delete'].status.id_str).remove();
						} else if (tweet.text) {
							tweet.user.following = true;
							$('#result').prepend(parseTweet(tweet));
						}
					});
				}),
				jqxhr = $.ajax('https://userstream.twitter.com/1.1/user.json', {
					xhrFields: {
						onprogress: function (e) {
							responseProcessor(e.target);
						}
					}
				});

			jqxhrStream = jqxhr;
		}());
	});

	$('#welcomeMessage').text(getMessage('welcomeMessage'));
	refreshWelcomeMessage();

	$('#clearAllSettings').val(getMessage('clearAllSettings'));
	$('#clearAllSettings').click(function () {
		if (confirm(getMessage('clearAllSettingsConfirm'))) {
			console.log('clearAllSettings');

			localStorage.clear();
			window.location = '/index.html';
		}
	});

	$('#openSettings').click(function () {
		$('#settings').show();
	});
	$('#settingsDone').click(function () {
		$('#settings').hide();
	});

	$('#version').text(chrome.app.getDetails().version);
	$('#openAbout').click(function () {
		$('#about').show();
	});
	$('#aboutDone').click(function () {
		$('#about').hide();
	});

	(function () {
		var readTimer;

		$(document).on('webkitvisibilitychange', function () {
			var hidden = document.webkitHidden;
			console.log('webkitvisibilitychange', hidden);

			if (hidden) {
				clearTimeout(readTimer);
				$('.reading-tweet').removeClass('reading-tweet');
			} else {
				readTimer = setTimeout(function () {
					unreadCount = 0;
					updateTitle();
					$('.unread-tweet').removeClass('unread-tweet').addClass('reading-tweet');
				}, 2000);
			}
		});
	}());

	(function () {
		var queryParam = OAuth.getParameterMap(location.search.slice(1));

		if (queryParam.oauth_verifier) {
			$.post('https://api.twitter.com/oauth/access_token', {
				oauth_verifier: queryParam.oauth_verifier
			}, function (data) {
				data = OAuth.getParameterMap(data);
				console.log('oauth/access_token', data);

				localStorage.setItem('oauth_token', data.oauth_token);
				localStorage.setItem('oauth_token_secret', data.oauth_token_secret);

				$.get('https://api.twitter.com/1.1/account/verify_credentials.json', function (data) {
					new Notification(getMessage('tokenUpdateCompleted', data.screen_name), {
						icon: 'icon_128.png'
					});
					window.location = '/index.html';
				});
			});
		} else if (queryParam.denied) {
			if (localStorage.getItem('oauth_token') === queryParam.denied) {
				clearOAuthToken();
			}

			window.location = '/index.html';
		}
	}());

	$('body').show();
}());
