#!/usr/bin/env ruby
# 仅生成独立扩展开发工程，不运行编译、不替换现有自定义基座。
require 'xcodeproj'
require 'json'
require 'fileutils'
require 'optparse'

options = {}
OptionParser.new do |p|
  p.on('--bundle-id ID') { |v| options[:bundle] = v }
  p.on('--app-group ID') { |v| options[:group] = v }
  p.on('--team ID') { |v| options[:team] = v }
  p.on('--host-profile NAME') { |v| options[:host_profile] = v }
  p.on('--extension-profile NAME') { |v| options[:extension_profile] = v }
  p.on('--output DIR') { |v| options[:output] = v }
end.parse!
%i[bundle group team host_profile extension_profile].each do |key|
  abort "Missing --#{key.to_s.tr('_', '-')}" if options[key].to_s.empty?
end
abort 'App Group must start with group.' unless options[:group].start_with?('group.')
root = File.expand_path('../..', __dir__)
output = File.expand_path(options[:output] || File.join(root, 'out/ios-broadcast'))
abort "Output already exists: #{output}" if File.exist?(output)
FileUtils.mkdir_p(output)
project = Xcodeproj::Project.new(File.join(output, 'MeetingBroadcast.xcodeproj'))
host = project.new_target(:application, 'MeetingBroadcastHost', :ios, '15.0')
extension = project.new_target(:app_extension, 'MeetingBroadcast', :ios, '15.0')
host.add_dependency(extension)
embed = host.new_copy_files_build_phase('Embed App Extensions')
embed.dst_subfolder_spec = '13'
embed.add_file_reference(extension.product_reference).settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
version = JSON.parse(File.read(File.join(root, 'manifest.json')))
[host, extension].each do |target|
  ext = target == extension
  name = ext ? 'SampleHandler.swift' : 'HostApp.swift'
  FileUtils.cp(File.join(root, 'native/ios-broadcast', name), output)
  target.source_build_phase.add_file_reference(project.main_group.new_file(name))
  entitlements = { 'com.apple.security.application-groups' => [options[:group]] }
  Xcodeproj::Plist.write_to_path(entitlements, File.join(output, "#{target.name}.entitlements"))
  plist = {
    'CFBundleDisplayName' => ext ? '会议屏幕共享' : 'Meeting Broadcast Host',
    'CFBundleIdentifier' => '$(PRODUCT_BUNDLE_IDENTIFIER)',
    'CFBundleExecutable' => '$(EXECUTABLE_NAME)',
    'CFBundleName' => '$(PRODUCT_NAME)',
    'CFBundlePackageType' => ext ? 'XPC!' : 'APPL',
    'CFBundleShortVersionString' => version.fetch('versionName'),
    'CFBundleVersion' => version.fetch('versionCode').to_s,
    'RTCAppGroupIdentifier' => options[:group],
    'RTCScreenSharingExtension' => "#{options[:bundle]}.broadcast"
  }
  if ext
    plist['NSExtension'] = {
      'NSExtensionPointIdentifier' => 'com.apple.broadcast-services-upload',
      'NSExtensionPrincipalClass' => '$(PRODUCT_MODULE_NAME).SampleHandler',
      'NSExtensionAttributes' => { 'RPBroadcastProcessMode' => 'RPBroadcastProcessModeSampleBuffer' }
    }
  else
    plist['UILaunchScreen'] = {}
  end
  Xcodeproj::Plist.write_to_path(plist, File.join(output, "#{target.name}-Info.plist"))
  target.build_configurations.each do |config|
    config.build_settings.merge!({
      'PRODUCT_BUNDLE_IDENTIFIER' => ext ? "#{options[:bundle]}.broadcast" : options[:bundle],
      'SWIFT_VERSION' => '5.0', 'IPHONEOS_DEPLOYMENT_TARGET' => '15.0',
      'TARGETED_DEVICE_FAMILY' => '1,2', 'DEVELOPMENT_TEAM' => options[:team],
      'CODE_SIGN_STYLE' => 'Manual', 'PROVISIONING_PROFILE_SPECIFIER' => ext ? options[:extension_profile] : options[:host_profile],
      'INFOPLIST_FILE' => "#{target.name}-Info.plist",
      'CODE_SIGN_ENTITLEMENTS' => "#{target.name}.entitlements",
      'APPLICATION_EXTENSION_API_ONLY' => ext ? 'YES' : 'NO',
      'LD_RUNPATH_SEARCH_PATHS' => ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks'],
      'SKIP_INSTALL' => ext ? 'YES' : 'NO'
    })
  end
end
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(host)
scheme.set_launch_target(host)
scheme.save_as(project.path, 'MeetingBroadcastHost', true)
File.write(File.join(output, 'Podfile'), <<~POD)
  source 'https://cdn.cocoapods.org/'
  source 'https://github.com/livekit/podspecs.git'
  platform :ios, '15.0'
  use_frameworks! :linkage => :static
  project 'MeetingBroadcast.xcodeproj'
  target 'MeetingBroadcastHost' do
    pod 'LiveKitClient', '2.19.0'
  end
  target 'MeetingBroadcast' do
    pod 'LiveKitClient', '2.19.0'
  end
  post_install do |installer|
    minimum_ios = Gem::Version.new('15.0')
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        deployment_target = config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if deployment_target && Gem::Version.new(deployment_target) < minimum_ios
          config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = minimum_ios.to_s
        end
      end
    end
  end
POD
puts "Generated #{output}. Install pods and archive/export with Xcode; no build was run."
