require './synthinfo'

def self.info_doc_yaml(name, klass, key_mod=nil)
  res = "# #{name}\n\n"
  SonicPi::Synths::BaseInfo.get_all.each do |k, v|
    next unless v.is_a? klass
    next if k.to_s.include? 'replace_'
    mk = key_mod ? key_mod.call(k) : k
    res << "#{mk}:\n"
    self.format_to_yaml(res, v.doc, "  ")
    res << "  params:" "\n"
    v.arg_info.each do |ak, av|
      res << "    #{ak}:\n"
      self.format_to_yaml(res, av[:doc], "      ")
      res << "      default: #{av[:default]}\n"
      res << "      constraints: |-\n"
      res << "        #{av[:constraints].empty? ? "none" : av[:constraints].join(",")}\n"
      res << "        #{av[:modulatable] ? "May be changed whilst playing" : "Can not be changed once set"}\n"
      res << "        Scaled with current BPM value\n" if av[:bpm_scale]
      res << "        Accepts note symbols such as :e3\n" if av[:midi]
      res << "        Has slide options for shaping changes\n" if av[:slidable]
    end
  end
  res
end

def self.format_to_yaml(res, document, indent)
  split_doc = document.to_s.gsub(/^(\r\n|\n)/, '').split(/ For example\: */)
  split_doc.each_with_index do |arr, index|
    doc = arr.split(/\R/)
    if index == 0
      res << indent + "help: |-\n"
    elsif
      res << indent + "example: |-\n"
    end
    doc.each do |r|
      r = r.gsub(/^( *)/, '')
      res << indent + "  " + "#{r.empty? ? '' : r}\n"
    end
  end
end

f = File.new("synth.yaml", 'w')
f << self.info_doc_yaml("Synths", SonicPi::Synths::SynthInfo)
f.close