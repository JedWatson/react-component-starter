var browserify = require('browserify'),
	shim = require('browserify-shim'),
	chalk = require('chalk'),
	del = require('del'),
	gulp = require('gulp'),
	bump = require('gulp-bump'),
	connect = require('gulp-connect'),
	deploy = require("gulp-gh-pages"),
	git = require("gulp-git"),
	less = require('gulp-less'),
	rename = require('gulp-rename'),
	streamify = require('gulp-streamify'),
	uglify = require('gulp-uglify'),
	gutil = require('gulp-util'),
	merge = require('merge-stream'),
	reactify = require('reactify'),
	run = require('run-sequence'),
	source = require('vinyl-source-stream'),
	watchify = require('watchify');


/**
 * Task configuration is loaded from config.js
 * 
 * Make any changes to the source or distribution files
 * and directory configuration there
 */

var config = require('./config');


/**
 * Bundle helpers
 */

function doBundle(target, name, dest) {
	return target.bundle()
		.on('error', function(e) {
			gutil.log('Browserify Error', e);
		})
		.pipe(source(name))
		.pipe(gulp.dest(dest))
		.pipe(connect.reload());
}

function watchBundle(target, name, dest) {
	return watchify(target)
		.on('update', function (scriptIds) {
			scriptIds = scriptIds
				.filter(function(i) { return i.substr(0,2) !== './' })
				.map(function(i) { return chalk.blue(i.replace(__dirname, '')) });
			if (scriptIds.length > 1) {
				gutil.log(scriptIds.length + ' Scripts updated:\n* ' + scriptIds.join('\n* ') + '\nrebuilding...');
			} else {
				gutil.log(scriptIds[0] + ' updated, rebuilding...');
			}
			doBundle(target, name, dest);
		})
		.on('time', function (time) {
			gutil.log(chalk.green(name + ' built in ' + (Math.round(time / 10) / 100) + 's'));
		});
}


/**
 * Prepare task for examples
 */

gulp.task('clean:examples', function(done) {
	del([config.example.dist], done);
});


/**
 * Build example files
 */

gulp.task('build:example:files', function() {
	return gulp.src(config.example.files.map(function(i) { return config.example.src + '/' + i }))
		.pipe(gulp.dest(config.example.dist))
		.pipe(connect.reload());
});


/**
 * Build example css from less
 */

gulp.task('build:example:css', function() {
	return gulp.src(config.example.src + '/' + config.example.stylesheets)
		.pipe(less())
		.pipe(gulp.dest(config.example.dist))
		.pipe(connect.reload());
});


/**
 * Build example scripts
 * 
 * Returns a gulp task with watchify when in development mode
 */

function buildExampleScripts(dev) {
	
	var dest = config.example.dist;
	
	var opts = dev ? watchify.args : {};
	opts.debug = dev ? true : false;
	opts.hasExports = true;
	
	return function() {
		
		var common = browserify(opts),
			bundle = browserify(opts).require('./' + config.component.src + '/' + config.component.file, { expose: config.component.pkgName }),
			standalone = browserify('./' + config.component.src + '/' + config.component.file, { standalone: config.component.name })
				.transform(reactify)
				.transform(shim);
		
		var examples = config.example.scripts.map(function(file) {
			return {
				file: file,
				bundle: browserify(opts).exclude(config.component.pkgName).add('./' + config.example.src + '/' + file)
			};
		});
		
		config.component.dependencies.forEach(function(pkg) {
			common.require(pkg);
			bundle.exclude(pkg);
			standalone.exclude(pkg);
			examples.forEach(function(eg) {
				eg.bundle.exclude(pkg);
			});
		});
		
		if (dev) {
			watchBundle(common, 'common.js', dest);
			watchBundle(bundle, 'bundle.js', dest);
			watchBundle(standalone, 'standalone.js', dest);
			examples.forEach(function(eg) {
				watchBundle(eg.bundle, eg.file, dest);
			});
		}
		
		return merge([
			doBundle(common, 'common.js', dest),
			doBundle(bundle, 'bundle.js', dest),
			doBundle(standalone, 'standalone.js', dest)
		].concat(examples.map(function(eg) {
			return doBundle(eg.bundle, eg.file, dest);
		})));
		
	}

};

gulp.task('watch:example:scripts', buildExampleScripts(true));
gulp.task('build:example:scripts', buildExampleScripts());


/**
 * Build examples
 */

gulp.task('build:examples', function(callback) {
	run(
		'clean:examples',
		[
			'build:example:files',
			'build:example:css',
			'build:example:scripts'
		],
		callback
	);
});

gulp.task('watch:examples', [
	'build:example:files',
	'build:example:css',
	'watch:example:scripts'
], function() {
	gulp.watch(config.example.files.map(function(i) { return config.example.src + '/' + i }), ['build:example:files']);
	gulp.watch([config.example.src + './' + config.example.stylesheets], ['build:example:css']);
});


/**
 * Serve task for local development
 */

gulp.task('dev:server', function() {
	connect.server({
		root: config.example.dist,
		port: 8000,
		livereload: true
	});
});


/**
 * Development task
 */

gulp.task('dev', [
	'dev:server',
	'watch:examples'
]);


/**
 * Build task
 */

gulp.task('clean:dist', function(done) {
	del([config.component.dist], done);
});

gulp.task('build:dist', ['clean:dist'], function() {
	
	var standalone = browserify('./' + config.component.src + '/' + config.component.file, {
			standalone: config.component.name
		})
		.transform(reactify)
		.transform(shim);
	
	config.component.dependencies.forEach(function(pkg) {
		standalone.exclude(pkg);
	});
	
	return standalone.bundle()
		.on('error', function(e) {
			gutil.log('Browserify Error', e);
		})
		.pipe(source(config.component.pkgName + '.js'))
		.pipe(gulp.dest(config.component.dist))
		.pipe(rename(config.component.pkgName + '.min.js'))
		.pipe(streamify(uglify()))
		.pipe(gulp.dest(config.component.dist));
	
});

gulp.task('build', [
	'build:dist',
	'build:examples'
]);


/**
 * Version bump tasks
 */

function getBumpTask(type) {
	return function() {
		return gulp.src(['./package.json', './bower.json'])
			.pipe(bump({ type: type }))
			.pipe(gulp.dest('./'));
	};
}

gulp.task('bump', getBumpTask('patch'));
gulp.task('bump:minor', getBumpTask('minor'));
gulp.task('bump:major', getBumpTask('major'));


/**
 * Git tag task
 * (version *must* be bumped first)
 */

gulp.task('publish:tag', function(done) {
	var pkg = require('./package.json');
	var v = 'v' + pkg.version;
	var message = 'Release ' + v;

	git.tag(v, message, function (err) {
		if (err) throw err;
		git.push('origin', v, function (err) {
			if (err) throw err;
			done();
		});
	});
});


/**
 * npm publish task
 * * (version *must* be bumped first)
 */

gulp.task('publish:npm', function(done) {
	require('child_process')
		.spawn('npm', ['publish'], { stdio: 'inherit' })
		.on('close', done);
});


/**
 * Deploy tasks
 */

gulp.task('publish:examples', ['build:examples'], function() {
	return gulp.src(config.example.dist + '/**/*').pipe(deploy());
});

gulp.task('release', ['publish:tag', 'publish:npm', 'publish:examples']);
